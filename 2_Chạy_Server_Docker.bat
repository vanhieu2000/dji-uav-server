@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo DJI UAV Server - Docker production
if not exist "deploy\secrets\jwt_secret" (
    echo Chua tao bi mat. Doc docs\OPERATIONS.md va chay python ops\init-secrets.py truoc.
    pause
    exit /b 1
)
docker compose config --quiet
if errorlevel 1 (
    echo Kiem tra .env: UAV_DOMAIN, S3_DOMAIN, HOST_IP va Docker Desktop.
    pause
    exit /b 1
)
docker compose up -d --build
if errorlevel 1 (
    echo Khoi dong chua thanh cong. Xem docker compose logs va docs\OPERATIONS.md.
    pause
    exit /b 1
)
echo Da gui yeu cau khoi dong. Can kiem tra health va tao admin; chua dong nghia Pilot/UAV da ket noi.
echo Dashboard HTTPS: domain UAV_DOMAIN trong .env, duong dan /dashboard/.
echo Trang hien truong: /m/; Pilot: /pilot-login/.
docker compose ps
pause
