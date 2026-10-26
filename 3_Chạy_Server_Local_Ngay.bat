@echo off
chcp 65001 >nul
echo =====================================================================
echo  KHỞI ĐỘNG NHANH SERVER LOCAL (KHÔNG CẦN CHỜ CÀI ĐẶT DOCKER)
echo =====================================================================
echo  Chế độ này chạy trực tiếp bằng Node.js sẵn có trên máy tính của bạn:
echo   - Tích hợp sẵn MQTT Broker (Port 1883)
echo   - Cổng HTTP Pilot 2 Login (Port 8080)
echo   - Cổng WebSocket Telemetry (Port 8080/ws)
echo   - Dashboard Giám Sát Realtime (Port 8080/dashboard)
echo =====================================================================
echo.

cd /d "%~dp0\backend"

if not exist "node_modules" (
    echo [1/2] Đang cài đặt thư viện cần thiết...
    call npm ci
)

echo Can cau hinh MYSQL_* trong .env va tao admin theo README.md.
echo [2/2] Đang khởi động Server...
start http://localhost:8080/dashboard
node server.js

pause
