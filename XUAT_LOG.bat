@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "backend\scripts\export-diagnostics.js"
pause
