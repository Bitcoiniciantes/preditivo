#Requires -Version 5.1
<#
.SYNOPSIS
  Supervisor simples do market-ingestion (Windows) - P0 confiabilidade.
.DESCRIPTION
  Roda o daemon buildado (node dist/index.js) e reinicia automaticamente em
  exit != 0 (crash). Exit 0 (shutdown gracioso via SIGINT/SIGTERM) NAO reinicia.
  Exit 3 (contrato com o daemon: porta ocupada = outra instancia ativa) NAO reinicia.
  Garantias de instancia unica: lockfile logs/daemon.lock (1 supervisor),
  deteccao de processo node do daemon pre-existente e checagem da porta 3001
  antes de cada start (1 daemon / 1 porta). Gate de build: -RequireBuild roda
  'npm run build'; sem o flag, aborta se dist estiver desatualizado vs src.
  Backoff 1s -> 15s; zera apos 60s de execucao saudavel. Guarda anti-loop:
  5 falhas rapidas (<10s) seguidas => espera 30s antes de tentar de novo.
  Nao usar `tsx watch` como alta disponibilidade (nao reinicia em crash).
  CAMINHO OFICIAL UNICO DE PRODUCAO: este supervisor + node dist/index.js.
.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/supervise-daemon.ps1 -RequireBuild
#>
param(
  [string]$Entry = 'dist/index.js',
  [string]$WorkDir = '',
  [int]$Port = 3001,
  [switch]$RequireBuild
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrEmpty($WorkDir)) {
  if ($PSScriptRoot) { $root = Split-Path -Parent $PSScriptRoot }
  else { $root = (Get-Location).Path }
} else {
  $root = $WorkDir
}
$logsDir = Join-Path $root 'logs'
$supLog = Join-Path $logsDir 'supervisor.log'
$lockFile = Join-Path $logsDir 'daemon.lock'
New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

function Write-SupLog([string]$msg) {
  $line = "{0} [supervisor] {1}" -f ([DateTime]::UtcNow.ToString('o')), $msg
  Add-Content -LiteralPath $supLog -Value $line
  Write-Output $line
}

if (-not (Test-Path -LiteralPath (Join-Path $root $Entry))) {
  Write-SupLog "$Entry ausente em $root - rode 'npm run build' antes."
  exit 2
}

# ── Gate de build: dist deve cobrir o src vigente ──
function Test-BuildFresh {
  $distFile = Join-Path $root $Entry
  if (-not (Test-Path -LiteralPath $distFile)) { return $false }
  $distTime = (Get-Item -LiteralPath $distFile).LastWriteTimeUtc
  $stale = Get-ChildItem -LiteralPath (Join-Path $root 'src') -Recurse -Filter '*.ts' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTimeUtc -gt $distTime } |
    Select-Object -First 1
  return ($null -eq $stale)
}
if ($RequireBuild) {
  Write-SupLog "RequireBuild: executando 'npm run build'..."
  try {
    # NOTA: Start-Process nao resolve shims .cmd via PATHEXT — usar npm.cmd explícito.
    $build = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'build' `
      -WorkingDirectory $root -NoNewWindow -PassThru -Wait
  } catch {
    Write-SupLog "build NAO iniciou: $($_.Exception.Message)"
    exit 2
  }
  if ($build.ExitCode -ne 0) {
    Write-SupLog "build FALHOU (exit $($build.ExitCode)) - abortando, sem iniciar daemon."
    exit 2
  }
  Write-SupLog "build OK."
} elseif (-not (Test-BuildFresh)) {
  Write-SupLog "dist desatualizado em relacao ao src - rode com -RequireBuild ou 'npm run build' antes."
  exit 2
}

# ── Deteccao de processo existente + porta ocupada (1 daemon / 1 porta) ──
# Ordem proposital: ANTES do lockfile, para nunca sobrescrever o lock de um
# supervisor vivo nem limpar nada ao abortar.
function Get-DaemonProcs {
  # NOTA: o supervisor lanca 'node dist/index.js' com WorkingDirectory=root, entao o
  # CommandLine NAO contem o caminho do projeto — casar também 'dist/index.js' puro.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'market-ingestion[\\/].*(dist[\\/]index\.js|tsx.*watch src/index\.ts)|dist[\\/]index\.js' }
}
function Test-PortListening([int]$port) {
  try {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
    return @($c)
  } catch { return @() }
}
$others = @(Get-DaemonProcs | Where-Object { $_.ProcessId -ne $PID })
if ($others.Count -gt 0) {
  $who = ($others | ForEach-Object { "pid=$($_.ProcessId) [$($_.CommandLine.Substring(0, [Math]::Min(120, $_.CommandLine.Length)))]" }) -join ' | '
  Write-SupLog "processo do daemon ja existe: $who - abortando, sem criar segunda instancia."
  exit 0
}
$listeners = @(Test-PortListening $Port)
if ($listeners.Count -gt 0) {
  $owners = (($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ',')
  Write-SupLog "porta $Port ja em Listen (pid dono: $owners) - abortando, sem criar segunda instancia."
  exit 0
}

# ── Lockfile anti-dupla-instância (1 supervisor) ──
function Test-ProcessAlive([int]$pid) {
  try { $p = Get-Process -Id $pid -ErrorAction Stop; return (-not $p.HasExited) }
  catch { return $false }
}
if (Test-Path -LiteralPath $lockFile) {
  try {
    $lock = Get-Content -LiteralPath $lockFile -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ($lock.supervisorPid -and (Test-ProcessAlive ([int]$lock.supervisorPid))) {
      Write-SupLog "lock ativo (supervisor pid=$($lock.supervisorPid) desde $($lock.startedAtUtc)) - OUTRO supervisor ja esta no ar. Abortando, sem criar segunda instancia."
      exit 0
    }
    Write-SupLog "lock obsoleto (pid=$($lock.supervisorPid) morto) - assumindo supervisionamento."
  } catch {
    Write-SupLog "lock ilegivel ($($_.Exception.Message)) - assumindo supervisionamento (sera sobrescrito)."
  }
}
@{ supervisorPid = $PID; startedAtUtc = ([DateTime]::UtcNow.ToString('o')) } |
  ConvertTo-Json -Compress | Set-Content -LiteralPath $lockFile -NoNewline
Write-SupLog "lock adquirido: $lockFile (pid supervisor=$PID)"

function Clear-Lock { Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue }

$entryAbs = $Entry
Write-SupLog "iniciando (pid supervisor=$PID, cmd='node $entryAbs', workdir=$root)"
$backoffMs = 1000
$fastFails = 0
foreach ($i in 1..1000000) {
  $t0 = Get-Date
  # Stdout/stderr do filho vao para logs/daemon.log (.err) — sobrescritos a cada
  # restart; o historico de crashes e preservado em logs/daemon-crash.log (append).
  $p = Start-Process -FilePath 'node' -ArgumentList $entryAbs `
    -WorkingDirectory $root -NoNewWindow -PassThru -Wait `
    -RedirectStandardOutput (Join-Path $logsDir 'daemon.log') `
    -RedirectStandardError (Join-Path $logsDir 'daemon.err')
  $code = $p.ExitCode
  $uptime = ((Get-Date) - $t0).TotalSeconds
  if ($code -eq 0) {
    Write-SupLog ("exit 0 apos {0:N0}s - shutdown gracioso, NAO reiniciando." -f $uptime)
    Clear-Lock
    exit 0
  }
  if ($code -eq 3) {
    Write-SupLog ("exit 3 apos {0:N0}s - outra instancia detectada pelo daemon (porta ocupada), NAO reiniciando." -f $uptime)
    Clear-Lock
    exit 0
  }
  Write-SupLog ("exit {0} apos {1:N0}s - reiniciando em {2}ms." -f $code, $uptime, $backoffMs)
  if ($uptime -ge 60) { $backoffMs = 1000; $fastFails = 0 }
  elseif ($uptime -lt 10) {
    $fastFails++
    if ($fastFails -ge 5) {
      Write-SupLog "5 falhas rapidas seguidas - aguardando 30s (anti-loop)."
      Start-Sleep -Seconds 30
      $fastFails = 0
      $backoffMs = 1000
    }
  }
  Start-Sleep -Milliseconds $backoffMs
  $backoffMs = [Math]::Min($backoffMs * 2, 15000)
}
