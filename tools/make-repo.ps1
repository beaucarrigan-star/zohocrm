# Builds the GitHub repo folder from your two pipeline folders, code only.
#   powershell -ExecutionPolicy Bypass -File make-repo.ps1
# Creates C:\Users\Beau\jp-catalyst-pipelines (outside OneDrive) and runs "git init" there.
# Nothing is pushed anywhere. It also copies this kit's workflows, ci and .gitignore in (run it from the kit folder).

$ErrorActionPreference = "Stop"
$kit  = $PSScriptRoot
$zoho = "C:\Users\Beau\OneDrive - JusticePoint\Zoho"
$dest = Join-Path $env:USERPROFILE "jp-catalyst-pipelines"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# robocopy exit codes below 8 mean success
$skipDirs  = @("__pycache__", ".pytest_cache", "node_modules", "contracts", "Claude outputs", "fixtures", "_ingest")
$skipFiles = @("*.pdf", "*.PDF", "*.docx", "*.xlsx", "*.zip", "*.bak-*", "*.env", "html2pdf.bundle.min.js")

foreach ($p in "solicitation-pipeline", "contract-pipeline") {
    robocopy (Join-Path $zoho $p) (Join-Path $dest $p) /E /XD $skipDirs /XF $skipFiles /NFL /NDL /NJH /NJS | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "copy of $p failed" }
}
# the tests need fixtures, so keep a local copy of them only here (not committed)
robocopy (Join-Path $zoho "contract-pipeline\tests\fixtures") (Join-Path $dest "contract-pipeline\tests\fixtures") /E /NFL /NDL /NJH /NJS | Out-Null

foreach ($x in "ci", ".gitignore") { Copy-Item (Join-Path $kit $x) $dest -Recurse -Force }
# the kit stores the workflows in "workflows" (a folder named .github can't be delivered); GitHub needs .github\workflows
New-Item -ItemType Directory -Force -Path (Join-Path $dest ".github\workflows") | Out-Null
Copy-Item (Join-Path $kit "workflows\*.yml") (Join-Path $dest ".github\workflows") -Force

Push-Location $dest
if (-not (Test-Path ".git")) { git init -b main | Out-Null }
git add -A
Write-Host ""
Write-Host "Staged for commit. Review exactly what would go to GitHub:" -ForegroundColor Cyan
git status --short
Write-Host ""
Write-Host "Nothing under contracts\, fixtures\, *.pdf, *.docx or *.xlsx should be listed above." -ForegroundColor Yellow
Pop-Location
