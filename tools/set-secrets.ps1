# Copies the pipeline credentials from your local .env files into the GitHub repo's secrets.
# Values are never printed or shown. Only the secret NAMES are listed.
#
# Needs the GitHub CLI, signed in once:
#     winget install --id GitHub.cli -e        (then close and reopen PowerShell)
#     gh auth login                            (choose GitHub.com, HTTPS, "Login with a web browser")
# Then:
#     powershell -ExecutionPolicy Bypass -File .\set-secrets.ps1

$ErrorActionPreference = "Stop"
$repo = "beaucarrigan-star/zohocrm"
$sol  = Join-Path $env:USERPROFILE ".solpipe.env"
$con  = Join-Path $env:USERPROFILE ".conpipe.env"
$claude = Join-Path $env:USERPROFILE ".conpipe-claude.env"   # optional: Claude shadow reader + OCR settings

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI not found. Run: winget install --id GitHub.cli -e   then reopen PowerShell." }
cmd /c "gh auth status >nul 2>&1"
if ($LASTEXITCODE -ne 0) { throw "Not signed in to GitHub. Run: gh auth login" }
foreach ($f in $sol, $con) { if (-not (Test-Path $f)) { throw "Missing $f" } }

function Read-EnvFile($path) {
    $h = @{}
    foreach ($line in (Get-Content $path -Encoding UTF8)) {
        if ($line -match '^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$') {
            $v = $Matches[2]
            if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1, $v.Length - 2) }
            $h[$Matches[1]] = $v
        }
    }
    $h
}

function Set-GhSecret($name, $value) {
    if ([string]::IsNullOrEmpty($value)) { throw "No value for $name" }
    # via a temp file with no trailing newline, so nothing shows in the process list or console
    $tmp = Join-Path $env:TEMP ("ghsecret-" + [guid]::NewGuid().ToString("N") + ".txt")
    try {
        [IO.File]::WriteAllText($tmp, $value, (New-Object Text.UTF8Encoding($false)))
        cmd /c "gh secret set $name --repo $repo < `"$tmp`" >nul"
        if ($LASTEXITCODE -ne 0) { throw "gh secret set $name failed" }
    } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
    Write-Host "  set $name"
}

$s = Read-EnvFile $sol
$c = Read-EnvFile $con

Write-Host "Setting secrets on $repo"
foreach ($k in "ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN") { Set-GhSecret $k $s[$k] }
foreach ($k in "ZOHO_ACCOUNTS_URL", "ZOHO_API_DOMAIN") {
    if ($s.ContainsKey($k) -and $s[$k]) { Set-GhSecret $k $s[$k] } else { Write-Host "  skipped $k (not in .solpipe.env, the US default is used)" }
}
Set-GhSecret "SOL_PIPELINE_TOKEN" $s["PIPELINE_TOKEN"]
Set-GhSecret "CON_PIPELINE_TOKEN" $c["CON_PIPELINE_TOKEN"]

# Claude shadow reader + OCR: the key is a secret, the settings are repository variables (plain, visible in
# GitHub). Same names deploy-contracts.ps1 reads; ci/inject_env.py puts them on con_worker. Without this block a
# GitHub deploy turned CON_CLAUDE back to "off".
if (Test-Path $claude) {
    $cv = Read-EnvFile $claude
    if ($cv["CLAUDE_API_KEY"]) { Set-GhSecret "CLAUDE_API_KEY" $cv["CLAUDE_API_KEY"] } else { Write-Host "  skipped CLAUDE_API_KEY (not in .conpipe-claude.env)" }
    foreach ($k in "CLAUDE_WORKSPACE_ID", "CLAUDE_MODEL_EXTRACT", "CLAUDE_MODEL_REVIEW", "CON_CLAUDE", "CON_CLAUDE_MODELS",
                   "CON_CLAUDE_ESCALATE", "CON_CLAUDE_RERUN", "CON_CLAUDE_MAX_TOKENS", "CON_CLAUDE_MAX_CHARS",
                   "CON_OCR", "CON_OCR_MAX_PAGES", "CON_OCR_MAX_SECONDS", "CON_PDF_SECONDS") {
        if ($cv.ContainsKey($k) -and $cv[$k]) {
            cmd /c "gh variable set $k --repo $repo --body `"$($cv[$k])`" >nul"
            if ($LASTEXITCODE -ne 0) { throw "gh variable set $k failed" }
            Write-Host "  variable $k"
        }
    }
} else { Write-Host "  no $claude - Claude reader stays off after a GitHub deploy" }

Write-Host ""
$sec = Read-Host "Paste the Catalyst token from 'catalyst token:generate' (hidden, press Enter)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$plain = ($plain -replace '\s', '')
# A paste into the hidden prompt can silently come through as one stray character; the deploy then fails with
# "Invalid character in header content". Check the shape (never the value) before uploading.
if ($plain.Length -lt 20 -or $plain -match '[^!-~]') {
    throw "That does not look like a Catalyst token ($($plain.Length) characters). Run 'catalyst token:generate' again and paste only the token, or set it with: gh secret set CATALYST_TOKEN --repo $repo"
}
Set-GhSecret "CATALYST_TOKEN" $plain

Write-Host ""
Write-Host "Done. Secrets now on the repo:" -ForegroundColor Green
gh secret list --repo $repo
