@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-youdub.ps1" %*
if errorlevel 1 (
  echo.
  echo YouDub stop failed.
  pause
)
