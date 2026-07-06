@echo off

setlocal

for %%P in (3456) do (

  for /f "tokens=5" %%a in ('netstat -ano ^| findstr /C:":%%P " ^| findstr LISTENING') do (

    if not "%%a"=="" (

      echo [novel-downloader] Tat process cu tren port %%P ^(PID %%a^)

      taskkill /PID %%a /F >nul 2>&1

    )

  )

)

ping 127.0.0.1 -n 2 >nul
