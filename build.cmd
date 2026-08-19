@echo off
REM pa-desktop bridge + app build/verify helper (Linux/macOS/WSL: use build.sh)
setlocal
echo [pa-desktop] This is a Tauri v2 + React app. Use npm/cargo directly:
echo   npm install && npm run tauri dev   (in app/)
echo   cd app/src-tauri && cargo check
