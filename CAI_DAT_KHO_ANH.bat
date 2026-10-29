@echo off
chcp 65001 >nul
cd /d "%~dp0"
node "backend\scripts\setup-storage-local.js"
pause
