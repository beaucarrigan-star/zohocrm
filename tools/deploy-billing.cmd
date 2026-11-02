@echo off
rem One-click billing deploy. Runs deploy-billing.ps1 (tests, build, Catalyst deploy) on this PC.
rem The Catalyst project id is asked once and remembered in %USERPROFILE%\.billpipe.project
setlocal
set "PS1=C:\Users\Beau\OneDrive - JusticePoint\Billing - Billing Library\Billing\billing\_catalyst\billing-pipeline\deploy-billing.ps1"
set "PIDFILE=%USERPROFILE%\.billpipe.project"
if not exist "%PIDFILE%" (
  set /p PID=Billing Catalyst project id: 
  >"%PIDFILE%" echo %PID%
)
set /p PID=<"%PIDFILE%"
echo Deploying billing pipeline to Catalyst project %PID% ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -ProjectId %PID%
echo.
if errorlevel 1 (echo DEPLOY STOPPED - read the message above.) else (echo Done.)
pause
