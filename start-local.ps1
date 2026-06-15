$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Frontend = Join-Path $Root "frontend"
$Worker = Join-Path $Root "worker"
$NpmCache = Join-Path $Root ".npm-cache"

Write-Host "Building frontend..."
Push-Location $Frontend
npm install --cache $NpmCache
npm run build
Pop-Location

Write-Host "Applying local D1 migrations..."
Push-Location $Worker
npm install --cache $NpmCache
npm run d1:migrate:local

Write-Host "Starting Wrangler at http://localhost:8787 ..."
npx wrangler dev --port 8787
Pop-Location
