@echo off
setlocal
set "NODE_HOME=%LOCALAPPDATA%\node-portable\node-v22.16.0-win-x64"
if not exist "%NODE_HOME%\node.exe" (
  echo [novel-downloader] Chua co Node portable. Chay: powershell -ExecutionPolicy Bypass -File "%~dp0scripts\portable-node\setup.ps1"
  exit /b 1
)
set "PATH=%NODE_HOME%;%PATH%"
cd /d "%~dp0"
npm %*
