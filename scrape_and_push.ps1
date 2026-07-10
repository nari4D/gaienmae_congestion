$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeExe   = (Get-Command node).Source

# Run scraper
Write-Host "Running scraper..."
& $nodeExe (Join-Path $scriptDir "scraper.js")
if ($LASTEXITCODE -ne 0) {
    Write-Host "Scraper failed. Aborting push."
    exit 1
}

# Push to GitHub
Set-Location $scriptDir
git add events.js

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "No changes. Nothing to push."
    exit 0
}

git commit -m "auto update"
git push
Write-Host "Done."
