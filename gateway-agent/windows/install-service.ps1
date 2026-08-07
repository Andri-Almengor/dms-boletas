#requires -Version 5.1

[CmdletBinding()]
param(
  [switch]$NoStart,
  [switch]$ForceDownload
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ServiceName = 'DMSIntegrationGateway'
$ServiceDisplayName = 'DMS Integration Gateway'
$WinSWVersion = '2.12.0'
$WinSWUrl = "https://github.com/winsw/winsw/releases/download/v$WinSWVersion/WinSW-x64.exe"
$WinSWExpectedSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'
$AgentRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$RuntimeDirectory = Join-Path $AgentRoot '.service'
$LogsDirectory = Join-Path $AgentRoot 'logs'
$EnvironmentFile = Join-Path $AgentRoot '.env'
$WrapperPath = Join-Path $RuntimeDirectory "$ServiceName.exe"
$WrapperConfigPath = Join-Path $RuntimeDirectory "$ServiceName.xml"
$AgentEntryPoint = Join-Path $AgentRoot 'src\index.js'

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
  if ($NoStart) { $arguments += '-NoStart' }
  if ($ForceDownload) { $arguments += '-ForceDownload' }

  Write-Host 'Se requieren permisos de administrador. Windows mostrará una confirmación.' -ForegroundColor Yellow
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  exit $process.ExitCode
}

function Read-DotEnvFile([string]$Path) {
  $values = @{}
  foreach ($rawLine in Get-Content -LiteralPath $Path -Encoding UTF8) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith('#')) { continue }
    $separator = $line.IndexOf('=')
    if ($separator -lt 1) { continue }
    $name = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$name] = $value
  }
  return $values
}

function Assert-AgentConfiguration {
  if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
    throw "No existe $EnvironmentFile. Ejecute 'copy .env.example .env', complete los datos y vuelva a intentar."
  }

  $configuration = Read-DotEnvFile $EnvironmentFile
  $required = @('DMS_GATEWAY_URL', 'DMS_GATEWAY_ID', 'DMS_GATEWAY_TOKEN')
  foreach ($name in $required) {
    $value = [string]$configuration[$name]
    if ([string]::IsNullOrWhiteSpace($value)) {
      throw "Falta $name en $EnvironmentFile."
    }
    if ($value -match '(?i)reemplace|su-servicio|entregado-por|mostrado-una-sola-vez') {
      throw "$name todavía contiene el valor de ejemplo. Reemplácelo por el dato real."
    }
  }

  $uri = $null
  if (-not [Uri]::TryCreate([string]$configuration['DMS_GATEWAY_URL'], [UriKind]::Absolute, [ref]$uri)) {
    throw 'DMS_GATEWAY_URL no es una URL válida.'
  }
  $localHosts = @('localhost', '127.0.0.1', '::1')
  if ($uri.Scheme -ne 'https' -and $localHosts -notcontains $uri.Host) {
    throw 'DMS_GATEWAY_URL debe comenzar con https:// fuera del entorno local.'
  }
}

function Resolve-NodeExecutable {
  $command = Get-Command 'node.exe' -ErrorAction SilentlyContinue
  if (-not $command) {
    throw 'Node.js no está instalado o node.exe no se encuentra en PATH.'
  }
  $nodePath = [System.IO.Path]::GetFullPath($command.Source)
  $version = (& $nodePath --version 2>$null)
  if ($LASTEXITCODE -ne 0) {
    throw "No fue posible ejecutar Node.js desde $nodePath."
  }
  Write-Host "Node.js detectado: $version" -ForegroundColor DarkGray
  return $nodePath
}

function Test-AgentConfigurationWithNode([string]$NodePath) {
  Push-Location $AgentRoot
  try {
    & $NodePath $AgentEntryPoint '--check-config'
    if ($LASTEXITCODE -ne 0) {
      throw 'La validación de configuración del agente falló.'
    }
  } finally {
    Pop-Location
  }
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
}

function Install-WinSWRuntime {
  New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null

  $downloadRequired = $ForceDownload -or -not (Test-Path -LiteralPath $WrapperPath -PathType Leaf)
  if (-not $downloadRequired) {
    $currentHash = Get-Sha256 $WrapperPath
    if ($currentHash -ne $WinSWExpectedSha256) {
      Write-Warning 'El ejecutable WinSW existente no coincide con la versión aprobada; se descargará nuevamente.'
      $downloadRequired = $true
    }
  }

  if (-not $downloadRequired) { return }

  $temporaryPath = "$WrapperPath.download"
  Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Write-Host "Descargando WinSW $WinSWVersion desde el repositorio oficial..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri $WinSWUrl -OutFile $temporaryPath -UseBasicParsing

  $downloadedHash = Get-Sha256 $temporaryPath
  if ($downloadedHash -ne $WinSWExpectedSha256) {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    throw "La verificación SHA-256 de WinSW falló. Esperado: $WinSWExpectedSha256; recibido: $downloadedHash."
  }

  Move-Item -LiteralPath $temporaryPath -Destination $WrapperPath -Force
}

function Write-ServiceConfiguration([string]$NodePath) {
  New-Item -ItemType Directory -Path $LogsDirectory -Force | Out-Null
  $escapedNodePath = [Security.SecurityElement]::Escape($NodePath)
  $configuration = @"
<service>
  <id>$ServiceName</id>
  <name>$ServiceDisplayName</name>
  <description>Conecta de forma saliente la red local con DMS-Boletas en Render.</description>
  <executable>$escapedNodePath</executable>
  <arguments>"%BASE%\..\src\index.js"</arguments>
  <workingdirectory>%BASE%\..</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="restart" delay="1 min" />
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>30 sec</stoptimeout>
  <logpath>%BASE%\..\logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10485760</sizeThreshold>
    <keepFiles>10</keepFiles>
  </log>
</service>
"@
  Set-Content -LiteralPath $WrapperConfigPath -Value $configuration -Encoding UTF8
}

function Protect-EnvironmentFile {
  try {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & icacls.exe $EnvironmentFile '/inheritance:r' '/grant:r' "${currentIdentity}:(F)" '*S-1-5-18:(R)' '*S-1-5-32-544:(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'No fue posible ajustar completamente los permisos del archivo .env.'
    } else {
      Write-Host 'Permisos del archivo .env restringidos al usuario actual, SYSTEM y administradores.' -ForegroundColor DarkGray
    }
  } catch {
    Write-Warning "No fue posible restringir los permisos de .env: $($_.Exception.Message)"
  }
}

function Remove-ExistingService {
  $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $existingService) { return }

  Write-Host 'Se encontró una instalación anterior; se actualizará de forma segura.' -ForegroundColor Yellow
  try {
    if ($existingService.Status -ne 'Stopped') {
      & $WrapperPath stop | Out-Host
      Start-Sleep -Seconds 2
    }
    & $WrapperPath uninstall | Out-Host
    Start-Sleep -Seconds 2
  } catch {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
  }
}

if ($env:OS -ne 'Windows_NT') {
  throw 'Este instalador solo puede ejecutarse en Windows.'
}

if (-not (Test-IsAdministrator)) {
  Invoke-ElevatedSelf
}

Write-Host ''
Write-Host 'Instalación de DMS Integration Gateway como servicio de Windows' -ForegroundColor Cyan
Write-Host "Carpeta del agente: $AgentRoot" -ForegroundColor DarkGray

Assert-AgentConfiguration
$nodeExecutable = Resolve-NodeExecutable
Test-AgentConfigurationWithNode $nodeExecutable
Install-WinSWRuntime
Write-ServiceConfiguration $nodeExecutable
Protect-EnvironmentFile
Remove-ExistingService

Write-Host 'Instalando servicio...' -ForegroundColor Cyan
& $WrapperPath install | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw 'WinSW no pudo instalar el servicio.'
}

if (-not $NoStart) {
  Write-Host 'Iniciando servicio...' -ForegroundColor Cyan
  & $WrapperPath start | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw 'El servicio se instaló, pero no pudo iniciarse.'
  }
  Start-Sleep -Seconds 3
}

$service = Get-Service -Name $ServiceName -ErrorAction Stop
Write-Host ''
Write-Host "Servicio: $($service.DisplayName)" -ForegroundColor Green
Write-Host "Estado: $($service.Status)" -ForegroundColor Green
Write-Host 'Inicio: Automático retrasado' -ForegroundColor Green
Write-Host "Logs: $LogsDirectory" -ForegroundColor Green
Write-Host ''
Write-Host 'Comandos útiles:' -ForegroundColor Cyan
Write-Host '  npm run service:status'
Write-Host '  npm run service:logs'
Write-Host '  npm run service:restart'
Write-Host '  npm run service:uninstall'
