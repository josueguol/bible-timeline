[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet("dev", "prod")]
    [string]$Environment,

    [Parameter(Mandatory)]
    [ValidateSet("up", "down")]
    [string]$Action,

    [switch]$NoBuild,
    [switch]$NoWait,
    [switch]$RemoveData
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$rootDirectory = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $rootDirectory ".env.$Environment"
$templateFile = Join-Path $rootDirectory ".env.$Environment.example"
$composeFile = Join-Path $rootDirectory "docker-compose.yml"
$projectName = "bible-timeline-$Environment"

function Get-ComposeEnvironment {
    param([string]$Path)

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (!$trimmed -or $trimmed.StartsWith("#")) { continue }

        $separator = $trimmed.IndexOf("=")
        if ($separator -lt 1) { continue }

        $name = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim().Trim('"').Trim("'")
        $values[$name] = $value
    }

    return $values
}

function Resolve-DockerExecutable {
    $command = @(Get-Command docker -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($command.Count -eq 1) { return [string]$command[0].Source }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"),
        "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return [string]$candidate }
    }

    throw "No encuentro Docker Desktop. Instálalo e inícialo antes de ejecutar este script."
}

function Test-LocalPortAvailable {
    param([string]$HostAddress, [int]$Port)

    $listener = $null
    try {
        $ipAddress = [System.Net.IPAddress]::Parse($HostAddress)
        $listener = [System.Net.Sockets.TcpListener]::new($ipAddress, $Port)
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($listener) { $listener.Stop() }
    }
}

function Test-ProductionConfiguration {
    param([hashtable]$Values)

    $required = @(
        "POSTGRES_PASSWORD", "ADMIN_JWT_SECRET", "NOTES_JWT_SECRET",
        "PUBLIC_WEB_HOST", "API_HOST", "NOTES_API_HOST", "CONTENT_API_HOST",
        "ADMIN_WEB_HOST", "ADMIN_API_HOST", "FRONTEND_BASE_URL"
    )
    foreach ($name in $required) {
        $value = $Values[$name]
        if ([string]::IsNullOrWhiteSpace($value) -or $value -match "<.*>|CHANGE|example") {
            throw "Configuración de producción incompleta: define $name en .env.prod."
        }
    }

    if ($Values["ASPNETCORE_ENV"] -ne "Production") {
        throw "ASPNETCORE_ENV debe ser Production en .env.prod."
    }
    if ($Values["HOST_BIND"] -ne "127.0.0.1") {
        throw "HOST_BIND debe mantenerse en 127.0.0.1: el proxy compartido es quien publica 80/443."
    }
    if (!$Values["FRONTEND_BASE_URL"].StartsWith("https://", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "FRONTEND_BASE_URL debe usar HTTPS en producción."
    }
    foreach ($secretName in @("ADMIN_JWT_SECRET", "NOTES_JWT_SECRET")) {
        if ($Values[$secretName].Length -lt 32) {
            throw "$secretName debe tener al menos 32 caracteres."
        }
    }
}

if (!(Test-Path -LiteralPath $environmentFile -PathType Leaf)) {
    if ($Environment -eq "dev") {
        Copy-Item -LiteralPath $templateFile -Destination $environmentFile
        Write-Host "Creé .env.dev desde la plantilla. Ajusta sus valores si lo necesitas."
    }
    else {
        throw "Falta .env.prod. Copia .env.production.example a .env.prod, define los secretos y vuelve a ejecutar."
    }
}

$values = Get-ComposeEnvironment -Path $environmentFile
if ($Environment -eq "prod") { Test-ProductionConfiguration -Values $values }

$hostBind = $values["HOST_BIND"]
$gatewayPortText = $values["GATEWAY_PORT"]
$gatewayPort = 0
if ($hostBind -ne "127.0.0.1" -or ![int]::TryParse($gatewayPortText, [ref]$gatewayPort)) {
    throw ".env.$Environment debe definir HOST_BIND=127.0.0.1 y un GATEWAY_PORT numérico."
}

$portsToCheck = @($gatewayPort)
$adminGatewayPort = 0
if ($Environment -eq "dev") {
    if (![int]::TryParse($values["ADMIN_GATEWAY_PORT"], [ref]$adminGatewayPort) -or $adminGatewayPort -eq $gatewayPort) {
        throw ".env.dev debe definir un ADMIN_GATEWAY_PORT numérico y distinto de GATEWAY_PORT."
    }
    $portsToCheck += $adminGatewayPort
}

$docker = [string](Resolve-DockerExecutable)
$compose = @("compose", "--project-name", $projectName, "--env-file", $environmentFile, "--file", $composeFile)
if ($Environment -eq "dev") {
    $compose += @("--file", (Join-Path $rootDirectory "docker-compose.dev.yml"))
}

Push-Location $rootDirectory
try {
    if ($Action -eq "up") {
        $runningGateway = & $docker @compose ps --status running --quiet gateway
        if ($LASTEXITCODE -ne 0) { throw "No pude consultar el stack Docker $projectName." }

        if (!$runningGateway) {
            foreach ($port in $portsToCheck) {
                if (!(Test-LocalPortAvailable -HostAddress $hostBind -Port $port)) {
                    throw "El puerto ${hostBind}:$port ya está ocupado por otro proceso. Cambia la configuración antes de iniciar."
                }
            }
        }

        $arguments = @()
        $arguments += $compose
        $arguments += @("up", "--detach", "--remove-orphans")
        if (!$NoBuild) { $arguments += "--build" }
        if (!$NoWait) { $arguments += "--wait" }

        & $docker @arguments
        if ($LASTEXITCODE -ne 0) { throw "Docker Compose no pudo iniciar $projectName." }

        & $docker @compose ps
        if ($LASTEXITCODE -ne 0) { throw "Docker Compose no pudo mostrar el estado de $projectName." }

        Write-Host ""
        Write-Host "Stack $projectName listo."
        if ($Environment -eq "dev") {
            Write-Host "Web:   http://localhost:$gatewayPort"
            Write-Host "Admin: http://localhost:$adminGatewayPort"
        }
        else {
            Write-Host "Web:   https://$($values["PUBLIC_WEB_HOST"])"
            Write-Host "Admin: https://$($values["ADMIN_WEB_HOST"])"
            Write-Host "Gateway interno: http://${hostBind}:$gatewayPort (configura el proxy/TLS central hacia este puerto)."
        }
    }
    else {
        $arguments = @()
        $arguments += $compose
        $arguments += @("down", "--remove-orphans")
        if ($RemoveData) {
            Write-Warning "Se eliminarán los volúmenes de PostgreSQL del entorno $Environment."
            $arguments += "--volumes"
        }

        & $docker @arguments
        if ($LASTEXITCODE -ne 0) { throw "Docker Compose no pudo detener $projectName." }
    }
}
finally {
    Pop-Location
}
