$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$scraperJs = Join-Path $scriptDir "scraper.js"
$taskName  = "GaienmaeScrapeer"
$nodeExe   = (Get-Command node).Source

$action   = New-ScheduledTaskAction -Execute $nodeExe -Argument $scraperJs -WorkingDirectory $scriptDir
$trigger  = New-ScheduledTaskTrigger -Daily -At "06:00AM"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited | Out-Null

Write-Host "Done. Runs every Monday at 06:00."
Write-Host "To run now: Start-ScheduledTask -TaskName $taskName"
