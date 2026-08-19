@echo off
REM pa-desktop Windows build script
REM Produces the .exe / NSIS installer under app\src-tauri\target\release\bundle\
setlocal
cd /d "%~dp0app"

echo [1/3] Frontend build (tsc + vite)...
call npm run build || goto :err

echo [2/3] Cargo check...
cd src-tauri
call cargo check 2>&1 || goto :err
cd ..

echo [3/3] Tauri release build (.exe)...
call npm run tauri build 2>&1 || goto :err

echo.
echo DONE. Installer is in app\src-tauri\target\release\bundle\msi\ and \nsis\
goto :eof

:err
echo.
echo BUILD FAILED.
exit /b 1
