@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title DJI UAV - Chay local
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0ops\start-local.ps1"
if errorlevel 1 (
    echo.
    echo Khong khoi dong duoc. Doc thong bao phia tren va docs\CHAY_LOCAL.md.
    pause
)
endlocal
