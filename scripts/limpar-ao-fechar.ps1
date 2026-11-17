param(
  [Parameter(Mandatory = $true)][int]$WrapperPid,
  [Parameter(Mandatory = $true)][int]$TreePid,
  [Parameter(Mandatory = $true)][string]$Root
)

$ErrorActionPreference = 'SilentlyContinue'
$log = Join-Path $env:TEMP 'preditivo-watchdog.log'

function Write-Log([string]$Message) {
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message" | Add-Content -Path $log
}

function Stop-Tree([int]$ProcessId) {
  if ($ProcessId -gt 0 -and $ProcessId -ne $PID) {
    & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
  }
}

function Test-ProjectProcess([int]$ProcessId) {
  $cur = $ProcessId
  for ($i = 0; $i -lt 12 -and $cur -gt 0; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
    if (-not $p) { break }
    $cmd = [string]$p.CommandLine
    if ($cmd -and $cmd.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    if ($cmd -and $cmd -match 'market-ingestion') { return $true }
    $cur = [int]$p.ParentProcessId
  }
  return $false
}

# Espera o host do painel terminar (X, Ctrl+C, crash ou exit normal).
$deadline = (Get-Date).AddHours(12)
while ((Get-Process -Id $WrapperPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
}
if (Get-Process -Id $WrapperPid -ErrorAction SilentlyContinue) {
  Write-Log "timeout wrapper=$WrapperPid (segue vivo; nada foi feito)"
  exit 0
}

$deathTime = Get-Date
Write-Log "wrapper=$WrapperPid encerrou; limpando tree=$TreePid"

# Se o usuario ja reabriu o painel, nao toca nas portas do novo painel.
$newWrappers = @(Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -match '-File\s+.*abrir-painel\.ps1'
})
if ($newWrappers.Count -gt 0) {
  Write-Log "novo wrapper detectado; limpeza de portas abortada"
  exit 0
}

# Mata a arvore do npm/cmd, se ainda for a arvore correta e antiga.
$tp = Get-CimInstance Win32_Process -Filter "ProcessId=$TreePid" -ErrorAction SilentlyContinue
if ($tp -and [string]$tp.CommandLine -match 'npm run dev') {
  $created = $null
  try { $created = [datetime]$tp.CreationDate } catch { }
  if (-not $created -or $created -lt $deathTime) {
    Stop-Tree $TreePid
  }
}

# Mata qualquer listener do projeto que tenha sobrado nas portas do painel.
for ($round = 0; $round -lt 3; $round++) {
  $conns = @(Get-NetTCPConnection -LocalPort 3000, 3001, 3002 -State Listen -ErrorAction SilentlyContinue)
  if ($conns.Count -eq 0) { break }
  foreach ($c in $conns) {
    $owner = [int]$c.OwningProcess
    $ownerInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
    $created = $null
    if ($ownerInfo) { try { $created = [datetime]$ownerInfo.CreationDate } catch { } }
    # Processo criado depois da morte do host = painel novo; nao matar.
    if ($created -and $created -ge $deathTime) { continue }
    if (Test-ProjectProcess $owner) {
      Stop-Tree $owner
    }
  }
  Start-Sleep -Milliseconds 700
}

# Supervisor antigo do projeto, se existir.
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -match 'supervise-daemon\.ps1'
} | ForEach-Object {
  if ([string]$_.CommandLine -match [regex]::Escape($Root)) {
    $created = $null
    try { $created = [datetime]$_.CreationDate } catch { }
    if (-not $created -or $created -lt $deathTime) {
      Stop-Tree ([int]$_.ProcessId)
    }
  }
}

Write-Log "limpeza concluida"
