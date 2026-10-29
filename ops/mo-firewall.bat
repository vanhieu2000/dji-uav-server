@echo off
chcp 65001 >nul
title Mo Tuong Lua Windows cho DJI UAV Server
echo =====================================================================
echo   TIEN ICH MO CONG TUONG LUA WINDOWS CHO DJI PILOT 2 VA MAVIC 3T
echo =====================================================================
echo.

:: Kiem tra quyen Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [CANH BAO] Ban can chay file nay voi quyen Administrator!
    echo Hay nhap chuot phai vao file mo-firewall.bat va chon "Run as administrator".
    echo.
    pause
    exit /b 1
)

echo Dang them cac quy tac Inbound tren Windows Firewall...
echo.

:: 1. Cong 1883 TCP cho MQTT Broker (DJI Pilot 2 Cloud API)
netsh advfirewall firewall delete rule name="DJI UAV MQTT 1883" >nul 2>&1
netsh advfirewall firewall add rule name="DJI UAV MQTT 1883" dir=in action=allow protocol=TCP localport=1883 >nul 2>&1
echo  [x] Cong 1883 TCP (MQTT Broker Aedes)           : DA MO THANH CONG

:: 2. Cong 8080 TCP cho Web API / Pilot Login / Dashboard
netsh advfirewall firewall delete rule name="DJI UAV HTTP 8080" >nul 2>&1
netsh advfirewall firewall add rule name="DJI UAV HTTP 8080" dir=in action=allow protocol=TCP localport=8080 >nul 2>&1
echo  [x] Cong 8080 TCP (Web / Pilot Login / API)     : DA MO THANH CONG

:: 3. Cong 3000 TCP (neu su dung port 3000 mac dinh)
netsh advfirewall firewall delete rule name="DJI UAV HTTP 3000" >nul 2>&1
netsh advfirewall firewall add rule name="DJI UAV HTTP 3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
echo  [x] Cong 3000 TCP (Web Port 3000 fallback)      : DA MO THANH CONG

:: 4. Cong 1935 TCP cho RTMP Live Video Streaming
netsh advfirewall firewall delete rule name="DJI UAV RTMP 1935" >nul 2>&1
netsh advfirewall firewall add rule name="DJI UAV RTMP 1935" dir=in action=allow protocol=TCP localport=1935 >nul 2>&1
echo  [x] Cong 1935 TCP (RTMP Video Ingest tu Mavic)  : DA MO THANH CONG

:: 5. Cong 8000 TCP cho HTTP-FLV Live Streaming tren Web
netsh advfirewall firewall delete rule name="DJI UAV HTTP-FLV 8000" >nul 2>&1
netsh advfirewall firewall add rule name="DJI UAV HTTP-FLV 8000" dir=in action=allow protocol=TCP localport=8000 >nul 2>&1
echo  [x] Cong 8000 TCP (HTTP-FLV Live Stream cho Web): DA MO THANH CONG

echo.
echo =====================================================================
echo  DA MO DAY DU CAC CONG MANG! Tay cam DJI RC va UAV co the ket noi.
echo =====================================================================
echo.
pause

