# Deploy col_parse (the Collections Report PDF parser) into the existing contract-pipeline Catalyst project.
# Run from this folder in PowerShell:   powershell -ExecutionPolicy Bypass -File .\deploy-collections.ps1
#
# Same proven steps as deploy-contracts.ps1 (Python 3.9 for packaging, Linux wheels, no bin\ launchers,
# BOM-free config, --project on the command). Deploys ONLY col_parse; con_api / con_worker are untouched.
# col_parse holds no Zoho credentials - just COL_PARSE_TOKEN, created in %USERPROFILE%\.colpipe.env on first run.

$ErrorActionPreference = "Stop"
$src   = $PSScriptRoot
$build = Join-Path $env:LOCALAPPDATA "colpipe-build"
$colEnv = Join-Path $env:USERPROFILE ".colpipe.env"
$ProjectId = "31190000000040038"   # contract-pipeline

if (-not (Test-Path $colEnv)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $tok = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
    [IO.File]::WriteAllText($colEnv, "COL_PARSE_TOKEN=$tok`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Created $colEnv with a new COL_PARSE_TOKEN."
}
$token = ((Get-Content $colEnv | Where-Object { $_ -match "^COL_PARSE_TOKEN=" }) -replace "^COL_PARSE_TOKEN=", "").Trim()
if (-not $token) { throw "COL_PARSE_TOKEN missing in $colEnv" }

if (-not (Get-Command catalyst -ErrorAction SilentlyContinue)) { cmd /c "npm install -g zcatalyst-cli 2>&1" }
if (-not (Get-Command python -ErrorAction SilentlyContinue)) { throw "Python 3.9+ is required on PATH" }

# ---- Python 3.9 for packaging (reuses the copy the other pipelines already found or downloaded) ----
$py39 = $null
foreach ($c in @("$env:LOCALAPPDATA\Programs\Python\Python39\python.exe", "C:\Program Files\Python39\python.exe",
                 "$env:LOCALAPPDATA\solpipe-python39\tools\python.exe", "$env:LOCALAPPDATA\conpipe-python39\tools\python.exe")) {
    if (Test-Path $c) { $py39 = $c; break }
}
if (-not $py39) { throw "Python 3.9 packaging copy not found - run ..\contract-pipeline\deploy-contracts.ps1 once first" }
if ($py39 -match " ") { $py39 = (New-Object -ComObject Scripting.FileSystemObject).GetFile($py39).ShortPath }
cmd /c "catalyst config:set python3_9.bin=$py39 2>&1"

# ---- Golden gate ----
cmd /c "python -c ""import pytest, pdfplumber, reportlab"" >nul 2>&1"
if ($LASTEXITCODE -ne 0) { cmd /c "python -m pip install --user --quiet pytest pdfplumber reportlab 2>&1" }
Push-Location $src
try {
    cmd /c "python -m pytest tests -q -p no:cacheprovider 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "Parser tests failed - NOT deploying." }
} finally { Pop-Location }

# ---- Build tree ----
New-Item -ItemType Directory -Force -Path $build | Out-Null
Get-ChildItem $build -Exclude ".catalystrc" | Remove-Item -Recurse -Force
Copy-Item (Join-Path $src "catalyst.json") $build
$dst = Join-Path $build "functions\col_parse"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Get-ChildItem (Join-Path $src "col_parse") -File | Copy-Item -Destination $dst
Copy-Item (Join-Path $src "fn_config\col_parse.json") (Join-Path $dst "catalyst-config.json")
python -m pip install --quiet --target $dst --platform manylinux2014_x86_64 --python-version 3.9 --implementation cp `
    --only-binary=:all: --no-warn-conflicts "pdfminer.six==20250506" "pdfplumber==0.11.7"
if ($LASTEXITCODE -ne 0) { throw "Could not vendor pdfplumber for col_parse" }
Remove-Item (Join-Path $dst "bin") -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem $dst -Recurse -Directory -Filter "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

$cfgPath = Join-Path $dst "catalyst-config.json"
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$cfg.deployment.env_variables = [ordered]@{ "COL_PARSE_TOKEN" = $token }
[IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))

Push-Location $build
try {
    $who = cmd /c "catalyst whoami 2>&1" | Out-String
    if ($LASTEXITCODE -ne 0 -or $who -match "haven't logged in|not logged in|login") { cmd /c "catalyst login" }
    cmd /c "catalyst deploy --only functions:col_parse --project $ProjectId 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "catalyst deploy failed - see the output above" }
} finally { Pop-Location }

Set-Clipboard -Value $token
Write-Host ""
Write-Host "Deployed. Check https://contract-pipeline-911327312.development.catalystserverless.com/server/col_parse/health"
Write-Host "COL_PARSE_TOKEN is now on your clipboard - paste it into the Deluge function collections_parse_report"
Write-Host "(replace <COL_PARSE_TOKEN>)."
