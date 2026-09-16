@echo off
setlocal
cd /d "%~dp0"

set "APP_NAME=Download and Change"
set "PORT=3456"

REM Prefer system Node, then repo portable, then LocalAppData portable
where node >nul 2>&1
if not errorlevel 1 goto :have_node

if exist "%~dp0.node-portable\node-v22.18.0-win-x64\node.exe" (
  set "PATH=%~dp0.node-portable\node-v22.18.0-win-x64;%PATH%"
  goto :have_node
)

if exist "%LOCALAPPDATA%\node-portable\node-v22.16.0-win-x64\node.exe" (
  set "PATH=%LOCALAPPDATA%\node-portable\node-v22.16.0-win-x64;%PATH%"
  goto :have_node
)

echo [%APP_NAME%] Khong tim thay Node.js.
echo Cai Node hoac chay install.bat.
pause
exit /b 1

:have_node
if not exist "node_modules\" (
  echo [%APP_NAME%] Chua co node_modules. Dang npm install...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

REM Stop previous instance on this port if stop-dev.cmd exists
if exist "%~dp0stop-dev.cmd" call "%~dp0stop-dev.cmd"

echo.
echo [%APP_NAME%] http://localhost:%PORT%
echo Powered by Qin · 2026 Produced by QinQin
echo Nhan Ctrl+C de dung server.
echo.

set "HOST=127.0.0.1"
set "PORT=%PORT%"
node server.js
