# Deploy ship_parse (Allied Equipment Shipped .xlsx parser) into the existing contract-pipeline Catalyst project.
# Run from this folder in PowerShell:   powershell -ExecutionPolicy Bypass -File .\deploy-ship.ps1
# Same steps as deploy-scram.ps1. Deploys ONLY ship_parse. Holds no Zoho credentials, just SHIP_PARSE_TOKEN,
# created in %USERPROFILE%\.shippipe.env on first run and copied to the clipboard at the end.

$ErrorActionPreference = "Stop"
$src   = $PSScriptRoot
$build = Join-Path $env:LOCALAPPDATA "shippipe-build"
$scEnv = Join-Path $env:USERPROFILE ".shippipe.env"
$ProjectId = "31190000000040038"   # contract-pipeline

if (-not (Test-Path $scEnv)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $tok = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
    [IO.File]::WriteAllText($scEnv, "SHIP_PARSE_TOKEN=$tok`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Created $scEnv with a new SHIP_PARSE_TOKEN."
}
$token = ((Get-Content $scEnv | Where-Object { $_ -match "^SHIP_PARSE_TOKEN=" }) -replace "^SHIP_PARSE_TOKEN=", "").Trim()
if (-not $token) { throw "SHIP_PARSE_TOKEN missing in $scEnv" }

if (-not (Get-Command catalyst -ErrorAction SilentlyContinue)) { cmd /c "npm install -g zcatalyst-cli 2>&1" }

$py39 = $null
foreach ($c in @("$env:LOCALAPPDATA\Programs\Python\Python39\python.exe", "C:\Program Files\Python39\python.exe",
                 "$env:LOCALAPPDATA\solpipe-python39\tools\python.exe", "$env:LOCALAPPDATA\conpipe-python39\tools\python.exe")) {
    if (Test-Path $c) { $py39 = $c; break }
}
if (-not $py39) { throw "Python 3.9 packaging copy not found - run ..\contract-pipeline\deploy-contracts.ps1 once first" }
if ($py39 -match " ") { $py39 = (New-Object -ComObject Scripting.FileSystemObject).GetFile($py39).ShortPath }
cmd /c "catalyst config:set python3_9.bin=$py39 2>&1"
# Use whatever python is on PATH for the tests and pip; fall back to the 3.9 copy when PATH has none
# (a PowerShell opened from File Explorer often lacks it).
$python = $py39
$onPath = Get-Command python -ErrorAction SilentlyContinue
if ($onPath) { $python = $onPath.Source }
Write-Host "Using python: $python"

# ---- Golden gate ----
cmd /c "$python -c ""import pytest, openpyxl, flask"" >nul 2>&1"
if ($LASTEXITCODE -ne 0) { cmd /c "$python -m pip install --user --quiet pytest openpyxl flask 2>&1" }
Push-Location $src
try {
    cmd /c "$python -m pytest tests -q -p no:cacheprovider 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "Parser tests failed - NOT deploying." }
} finally { Pop-Location }

# ---- Build tree ----
New-Item -ItemType Directory -Force -Path $build | Out-Null
Get-ChildItem $build -Exclude ".catalystrc" | Remove-Item -Recurse -Force
Copy-Item (Join-Path $src "catalyst.json") $build
$dst = Join-Path $build "functions\ship_parse"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Get-ChildItem (Join-Path $src "ship_parse") -File | Copy-Item -Destination $dst
Copy-Item (Join-Path $src "fn_config\ship_parse.json") (Join-Path $dst "catalyst-config.json")
# openpyxl and et_xmlfile are pure Python; flask is provided by the Catalyst advancedio runtime.
& $python -m pip install --quiet --target $dst --platform manylinux2014_x86_64 --python-version 3.9 --implementation cp `
    --only-binary=:all: --no-warn-conflicts "openpyxl==3.1.5" "et_xmlfile==2.0.0"
if ($LASTEXITCODE -ne 0) { throw "Could not vendor openpyxl for ship_parse" }
Remove-Item (Join-Path $dst "bin") -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $dst -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

$cfgPath = Join-Path $dst "catalyst-config.json"
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$cfg.deployment.env_variables = [ordered]@{ "SHIP_PARSE_TOKEN" = $token }
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))

Push-Location $build
try {
    $who = cmd /c "catalyst whoami 2>&1" | Out-String
    if ($LASTEXITCODE -ne 0 -or $who -match "haven't logged in|not logged in|login") { cmd /c "catalyst login" }
    cmd /c "catalyst deploy --only functions:ship_parse --project $ProjectId 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "catalyst deploy failed - see the output above" }
} finally { Pop-Location }

Set-Clipboard -Value $token
Write-Host ""
Write-Host "Deployed. Check https://contract-pipeline-911327312.development.catalystserverless.com/server/ship_parse/health"
Write-Host "SHIP_PARSE_TOKEN is on your clipboard - paste it into the Deluge function equipment_shipped_import (replace <SHIP_PARSE_TOKEN>)."
