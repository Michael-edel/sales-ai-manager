[CmdletBinding()]
param(
    [string]$HostAddress = "127.0.0.1",
    [int]$Port = 8091
)

$ErrorActionPreference = "Stop"

$BridgeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path $BridgeDir ".env"
$Python = Join-Path $BridgeDir ".venv\Scripts\python.exe"
$LogDir = Join-Path $BridgeDir "logs"
$LogFile = Join-Path $LogDir "onec-mcp-bridge.log"
$StdoutLog = Join-Path $LogDir "uvicorn.stdout.log"
$StderrLog = Join-Path $LogDir "uvicorn.stderr.log"

function Write-BridgeLog {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp $Message" | Out-File -FilePath $LogFile -Append -Encoding utf8
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-Path -LiteralPath $EnvFile)) {
    Write-BridgeLog "ERROR .env file not found: $EnvFile"
    throw ".env file not found: $EnvFile"
}

if (-not (Test-Path -LiteralPath $Python)) {
    Write-BridgeLog "ERROR Python venv not found: $Python"
    throw "Python venv not found: $Python"
}

Get-Content -LiteralPath $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
        return
    }

    $separator = $line.IndexOf("=")
    if ($separator -lt 1) {
        return
    }

    $name = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }

    [Environment]::SetEnvironmentVariable($name, $value, "Process")
}

Set-Location -LiteralPath $BridgeDir
Write-BridgeLog "Starting onec-mcp-bridge on ${HostAddress}:${Port}"

$arguments = @(
    "-m",
    "uvicorn",
    "app.main:app",
    "--host",
    $HostAddress,
    "--port",
    $Port.ToString()
)

$process = Start-Process `
    -FilePath $Python `
    -ArgumentList $arguments `
    -WorkingDirectory $BridgeDir `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog `
    -NoNewWindow `
    -PassThru `
    -Wait

$exitCode = $process.ExitCode
Write-BridgeLog "onec-mcp-bridge stopped with exit code $exitCode"
exit $exitCode
