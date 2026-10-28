@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0backend"
node scripts\create-operator.js
pause
endlocal
