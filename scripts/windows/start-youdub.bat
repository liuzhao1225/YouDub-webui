@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-youdub.ps1" %*
if errorlevel 1 (
  echo.
  echo YouDub failed to start. Check data\logs and run setup-youdub.bat first.
  pause
)
