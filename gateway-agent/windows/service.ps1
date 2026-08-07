#requires -Version 5.1

[CmdletBinding()]
param(
  [ValidateSet('status', 'start', 'stop', 'restart', 'logs')]
  [string]$Action = 'status',
  [int]$Tail = 80
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'DMSIntegrationGateway'
$AgentRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$RuntimeDirectory = Join-Path $AgentRoot '.service'
$LogsDirectory = Join-Path $AgentRoot 'logs'
$WrapperPath = Join-Path $RuntimeDirectory "$ServiceName.exe"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-ElevatedSelf {
  $arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f $PSCommandPath),
    '-Action', $Action,
    '-Tail', $Tail
  )
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  exit $process.ExitCode
}

function Get-InstalledService {
  return Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
}

function Show-ServiceStatus {
  $service = Get-InstalledService
  if (-not $service) {
    Write-Host 'El servicio DMS Integration Gateway no está instalado.' -ForegroundColor Yellow
    Write-Host 'Instálelo con: npm run service:install'
    return $null
  }

  $service.Refresh()
  $color = if ($service.Status -eq 'Running') { 'Green' } else { 'Yellow' }
  Write-Host "Servicio: $($service.DisplayName)"
  Write-Host "Estado: $($service.Status)" -ForegroundColor $color
  Write-Host "Inicio: $($service.StartType)"
  Write-Host "Carpeta: $AgentRoot"
  return $service
}

function Show-RecentLogs {
  if (-not (Test-Path -LiteralPath $LogsDirectory -PathType Container)) {
    Write-Host 'Todavía no existe la carpeta de logs.' -ForegroundColor Yellow
    return
  }

  $files = Get-ChildItem -LiteralPath $LogsDirectory -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
  if (-not $files) {
    Write-Host 'Todavía no hay logs disponibles.' -ForegroundColor Yellow
    return
  }

  $selected = $files | Select-Object -First 3
  foreach ($file in $selected) {
    Write-Host ''
    Write-Host "===== $($file.Name) · $($file.LastWriteTime) =====" -ForegroundColor Cyan
    Get-Content -LiteralPath $file.FullName -Tail ([Math]::Max(10, $Tail)) -ErrorAction SilentlyContinue
  }
}

if ($env:OS -ne 'Windows_NT') {
  throw 'Este comando solo puede ejecutarse en Windows.'
}

if ($Action -eq 'status') {
  Show-ServiceStatus | Out-Null
  exit 0
}

if ($Action -eq 'logs') {
  Show-ServiceStatus | Out-Null
  Show-RecentLogs
  exit 0
}

if (-not (Test-IsAdministrator)) {
  Invoke-ElevatedSelf
}

if (-not (Test-Path -LiteralPath $WrapperPath -PathType Leaf)) {
  throw 'No se encontró el ejecutable del servicio. Ejecute npm run service:install.'
}

$service = Get-InstalledService
if (-not $service) {
  throw 'El servicio no está instalado. Ejecute npm run service:install.'
}

switch ($Action) {
  'start' {
    & $WrapperPath start | Out-Host
  }
  'stop' {
    & $WrapperPath stop | Out-Host
  }
  'restart' {
    & $WrapperPath restart | Out-Host
  }
}

if ($LASTEXITCODE -ne 0) {
  throw "No fue posible ejecutar la acción '$Action' sobre el servicio."
}

$waitSeconds = if ($Action -eq 'stop') { 2 } else { 5 }
Start-Sleep -Seconds $waitSeconds
$service = Show-ServiceStatus

if ($Action -in @('start', 'restart') -and $service -and $service.Status -ne 'Running') {
  Write-Host ''
  Write-Host 'El proceso arrancó pero se detuvo inmediatamente. Últimos logs:' -ForegroundColor Red
  Show-RecentLogs
  throw "DMS Integration Gateway no logró mantenerse en ejecución. Revise los logs anteriores."
}
