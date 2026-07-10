$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$pushScript = Join-Path $scriptDir "scrape_and_push.ps1"
$taskName   = "GaienmaeScrapeer"

$action   = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$pushScript`"" -WorkingDirectory $scriptDir
$trigger  = New-ScheduledTaskTrigger -Daily -At "06:00PM"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -RunLevel Limited | Out-Null

Write-Host "Done. Runs every day at 06:00."
Write-Host "To run now: Start-ScheduledTask -TaskName $taskName"
