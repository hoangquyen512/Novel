@echo off

setlocal

cd /d "%~dp0"

set "NODE_HOME=%LOCALAPPDATA%\node-portable\node-v22.16.0-win-x64"

call "%~dp0stop-dev.cmd"

if not exist "%NODE_HOME%\node.exe" (
  echo [novel-downloader] Chua co Node portable. Chay install.bat hoac:
  echo   powershell -ExecutionPolicy Bypass -File "%~dp0scripts\portable-node\setup.ps1"
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [novel-downloader] Chua co node_modules. Dang chay npm install...
  call "%~dp0npm-portable.cmd" install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo.
echo [novel-downloader] Server: http://localhost:3456
echo Nhan Ctrl+C de dung server.
echo.

call "%~dp0npm-portable.cmd" run dev
