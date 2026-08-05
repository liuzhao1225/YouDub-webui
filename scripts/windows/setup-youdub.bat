@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-youdub.ps1" %*
if errorlevel 1 (
  echo.
  echo YouDub setup failed.
  pause
)
