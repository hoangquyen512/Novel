@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "NODE_HOME=%LOCALAPPDATA%\node-portable\node-v22.16.0-win-x64"

echo ========================================
echo  Novel Downloader - Cai dat lan dau
echo  (Node portable - khong can quyen Admin)
echo ========================================
echo.

echo [1/2] Kiem tra Node portable...
if not exist "%NODE_HOME%\node.exe" (
  echo Chua co Node. Dang tai ve %LOCALAPPDATA%\node-portable\ ...
  powershell -ExecutionPolicy Bypass -File "%~dp0scripts\portable-node\setup.ps1"
  if errorlevel 1 (
    echo LOI: Khong tai duoc Node portable. Kiem tra mang / proxy cong ty.
    pause
    exit /b 1
  )
) else (
  echo Da co Node portable: %NODE_HOME%
)

echo.
echo [2/2] Cai dependencies (npm install)...
call "%~dp0npm-portable.cmd" install
if errorlevel 1 (
  echo LOI: npm install that bai.
  pause
  exit /b 1
)

echo.
echo ========================================
echo  Cai dat xong!
echo  Chay tiep: start.bat
echo  Mo trinh duyet: http://localhost:3456
echo ========================================
echo.
pause
