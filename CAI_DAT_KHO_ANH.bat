@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0backend"
node scripts\setup-storage-local.js
if errorlevel 1 echo Khong hoan tat. Xem loi phia tren; chua xac nhan dong bo anh.
pause
endlocal
