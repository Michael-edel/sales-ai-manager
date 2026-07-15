[CmdletBinding()]
param(
    [string]$TunnelName = "sales-ai-onec-mcp"
)

$ErrorActionPreference = "Stop"

$BridgeDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WorkerDir = (Resolve-Path -LiteralPath (Join-Path $BridgeDir "..\worker")).Path
$Npx = (Get-Command npx.cmd -ErrorAction Stop).Source

Set-Location -LiteralPath $WorkerDir
& $Npx wrangler tunnel run $TunnelName --log-level info
exit $LASTEXITCODE
