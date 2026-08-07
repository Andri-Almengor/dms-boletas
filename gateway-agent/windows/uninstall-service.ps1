#requires -Version 5.1

[CmdletBinding()]
param(
  [switch]$RemoveLogs
)

$ErrorActionPreference = 'Stop'
$ServiceName = 'DMSIntegrationGateway'
$AgentRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$RuntimeDirectory = Join-Path $AgentRoot '.service'
$LogsDirectory = Join-Path $AgentRoot 'logs'
$EnvironmentFile = Join-Path $AgentRoot '.env'
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
    '-File', ('"{0}"' -f $PSCommandPath)
  )
  if ($RemoveLogs) { $arguments += '-RemoveLogs' }
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  exit $process.ExitCode
}

if ($env:OS -ne 'Windows_NT') {
  throw 'Este desinstalador solo puede ejecutarse en Windows.'
}

if (-not (Test-IsAdministrator)) {
  Invoke-ElevatedSelf
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service) {
  Write-Host 'Deteniendo y desinstalando DMS Integration Gateway...' -ForegroundColor Cyan
  if (Test-Path -LiteralPath $WrapperPath -PathType Leaf) {
    if ($service.Status -ne 'Stopped') {
      & $WrapperPath stop | Out-Host
      Start-Sleep -Seconds 2
    }
    & $WrapperPath uninstall | Out-Host
    Start-Sleep -Seconds 2
  } else {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
  }
}

$remaining = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($remaining) {
  Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  & sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

if (Test-Path -LiteralPath $RuntimeDirectory) {
  Remove-Item -LiteralPath $RuntimeDirectory -Recurse -Force
}

if ($RemoveLogs -and (Test-Path -LiteralPath $LogsDirectory)) {
  Remove-Item -LiteralPath $LogsDirectory -Recurse -Force
}

Write-Host ''
Write-Host 'El servicio DMS Integration Gateway fue desinstalado.' -ForegroundColor Green
if (Test-Path -LiteralPath $EnvironmentFile) {
  Write-Host "El archivo de configuración se conservó: $EnvironmentFile" -ForegroundColor Yellow
}
if (-not $RemoveLogs -and (Test-Path -LiteralPath $LogsDirectory)) {
  Write-Host "Los logs se conservaron: $LogsDirectory" -ForegroundColor Yellow
}
