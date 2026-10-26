@echo off
chcp 65001 >nul
echo =====================================================================
echo  KHỞI ĐỘNG HỆ THỐNG MÁY CHỦ UAV BẰNG DOCKER COMPOSE
echo =====================================================================
echo.

cd /d "%~dp0"

echo [1/2] Đang khởi chạy các container (EMQX, MediaMTX, MySQL, MinIO, Backend)...
docker compose up -d

if %errorLevel% neq 0 (
    echo.
    echo [X] LỖI: Docker chưa được khởi động hoặc chưa cài đặt xong!
    echo Vui lòng đảm bảo Docker Desktop đang mở (Running) trước khi chạy file này.
    echo.
    pause
    exit /b 1
)

echo.
echo [2/2] Toàn bộ hệ thống máy chủ đã sẵn sàng!
echo =====================================================================
echo  - Dashboard Giám Sát : http://localhost:8080/dashboard
echo  - DJI Pilot 2 Login   : http://localhost:8080/pilot-login
echo  - EMQX MQTT Dashboard : http://localhost:18083 (tài khoản trong file .env)
echo  - MinIO S3 Console    : http://localhost:9001 (tài khoản trong file .env)
echo =====================================================================
echo.
echo Đang mở Dashboard trên trình duyệt...
start http://localhost:8080/dashboard
pause
