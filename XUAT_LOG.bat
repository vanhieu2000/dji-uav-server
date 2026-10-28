@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0backend"
node scripts\export-diagnostics.js
pause
endlocal
