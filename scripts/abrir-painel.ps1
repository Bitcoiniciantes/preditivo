param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Stop-Tree([int]$ProcessId, [string]$Why) {
  Write-Host "[limpeza] $Why (PID $ProcessId)"
  & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
}

function Get-Chain([int]$ProcessId) {
  $list = @()
  $cur = $ProcessId
  for ($i = 0; $i -lt 12 -and $cur -gt 0; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
    if (-not $p) { break }
    $list += $p
    $cur = [int]$p.ParentProcessId
  }
  return $list
}

function Test-ProjectProcess([int]$ProcessId) {
  foreach ($p in Get-Chain $ProcessId) {
    $cmd = [string]$p.CommandLine
    $exe = [string]$p.ExecutablePath
    if ($cmd -and $cmd.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    if ($exe -and $exe.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0) { return $true }
    if ($cmd -and $cmd -match 'market-ingestion') { return $true }
  }
  return $false
}

# 1) Remove qualquer supervisor antigo do projeto.
Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -match 'supervise-daemon\.ps1'
} | ForEach-Object {
  $cmd = [string]$_.CommandLine
  if ($cmd.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    Stop-Tree ([int]$_.ProcessId) 'supervisor'
  }
}

# 2) Limpa apenas processos do projeto nas portas 3000/3001/3002.
#    Se o dono for externo, aborta em vez de matar.
foreach ($port in 3000, 3001, 3002) {
  $conns = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
  foreach ($c in $conns) {
    $owner = [int]$c.OwningProcess
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$owner" -ErrorAction SilentlyContinue
    if (Test-ProjectProcess $owner) {
      Stop-Tree $owner "porta $port"
    } else {
      $name = if ($p) { $p.Name } else { 'desconhecido' }
      Write-Host "ERRO: porta $port ocupada por processo externo (PID $owner, $name). Abortando."
      exit 2
    }
  }
}

Start-Sleep -Seconds 2
foreach ($port in 3000, 3001, 3002) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "ERRO: porta $port continua ocupada. Abortando."
    exit 2
  }
}

$env:PC_DISABLE_SQLITE = '1'
$env:NEXT_PUBLIC_PC_HISTORY_ENABLED = '0'
$env:NEXT_PUBLIC_PC_AI_ENABLED = '1'
$env:NEXT_PUBLIC_PC_IA_URL = 'http://localhost:3002'

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) {
  Write-Host 'ERRO: npm.cmd nao encontrado no PATH.'
  exit 2
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JobNative {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);
  [DllImport("kernel32.dll")]
  public static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpInfo, uint cbInfoLength);
  [DllImport("kernel32.dll")]
  public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr hObject);
  [StructLayout(LayoutKind.Sequential)]
  public struct IO_COUNTERS {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
    public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
    public IO_COUNTERS IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }
}
"@

$job = [JobNative]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) {
  Write-Host 'ERRO: nao foi possivel criar o Job Object.'
  exit 2
}

$info = New-Object JobNative+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
$info.BasicLimitInformation.LimitFlags = 0x2000
$size = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
$ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
[System.Runtime.InteropServices.Marshal]::StructureToPtr($info, $ptr, $false)
$ok = [JobNative]::SetInformationJobObject($job, 9, $ptr, [uint32]$size)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
if (-not $ok) {
  Write-Host 'ERRO: nao foi possivel configurar o Job Object.'
  [JobNative]::CloseHandle($job) | Out-Null
  exit 2
}

Write-Host '=== Subindo frontend :3000 + daemon :3001/:3002 (Ctrl+C ou feche a janela para parar) ==='

# Associa o proprio PowerShell ao job ANTES de criar os filhos: assim toda a
# arvore (cmd/npm/concurrently/next/tsx) herda o job. Se o processo atual ja
# estiver em outro job, cai no fallback de associar o filho.
$current = [System.Diagnostics.Process]::GetCurrentProcess()
$assignedCurrent = [JobNative]::AssignProcessToJobObject($job, $current.Handle)

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $env:ComSpec
$psi.Arguments = '/d /s /c "npm run dev"'
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $false
$proc = [System.Diagnostics.Process]::Start($psi)

if (-not $assignedCurrent) {
  $assignedChild = [JobNative]::AssignProcessToJobObject($job, $proc.Handle)
  if (-not $assignedChild) {
    Write-Host 'AVISO: Job Object indisponivel; o watchdog fará a limpeza ao fechar.'
  }
}

# Watchdog independente: criado via WMI (fora do console/job) e sobrevive ao X.
# Se o Job Object falhar, ele mata a arvore e libera as portas quando o host sair.
try {
  $watchdog = Join-Path $PSScriptRoot 'limpar-ao-fechar.ps1'
  $wdCmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdog`" -WrapperPid $PID -TreePid $($proc.Id) -Root `"$root`""
  $wd = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $wdCmd }
  if ($wd.ReturnValue -ne 0) {
    Write-Host "AVISO: watchdog nao iniciou (ReturnValue=$($wd.ReturnValue))."
  }
} catch {
  Write-Host "AVISO: watchdog nao iniciou: $($_.Exception.Message)"
}

if (-not $NoBrowser -and $env:PAINEL_NO_BROWSER -ne '1') {
  $open = @'
$url = 'http://127.0.0.1:3000/painelcolorido/'
for ($i = 0; $i -lt 120; $i++) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -ge 200) { Start-Process $url; break }
  } catch { }
  Start-Sleep -Milliseconds 500
}
'@
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-Command', $open) -WindowStyle Hidden | Out-Null
}

try {
  $proc.WaitForExit()
  $code = $proc.ExitCode
  Write-Host "Painel encerrado (exit=$code)."
} finally {
  # KILL_ON_JOB_CLOSE: fecha o job e derruba toda a arvore (inclusive este PS).
  [JobNative]::CloseHandle($job) | Out-Null
}

if ($code -ne 0) { exit 1 }
