@echo off
chcp 65001 >nul
cd /d "%~dp0backend"
echo Kiem tra va khoi phuc chu Viet bi sai ma hoa. Tu dong sao luu truoc khi sua.
node scripts\repair-vietnamese.js --apply
if errorlevel 1 echo Khong hoan tat. Xem loi ben tren; khong tu sua chuoi khong xac dinh.
pause
