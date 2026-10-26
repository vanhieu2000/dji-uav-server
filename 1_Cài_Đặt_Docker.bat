@echo off
chcp 65001 >nul
echo =====================================================================
echo  HƯỚNG DẪN CÀI ĐẶT WSL2 VÀ DOCKER DESKTOP TRÊN WINDOWS 11
echo =====================================================================
echo.

:: Kiểm tra quyền Administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] CẢNH BÁO: Vui lòng click chuột phải vào file này và chọn "Run as administrator" (Chạy với quyền quản trị viên)!
    echo.
    pause
    exit /b 1
)

echo [1/3] Đang kích hoạt WSL2 cho Windows 11...
wsl --install --no-distribution
echo.

echo [2/3] Đang tải và cài đặt Docker Desktop for Windows...
winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements

echo.
echo [3/3] Hoàn tất quá trình cài đặt!
echo =====================================================================
echo  LƯU Ý QUAN TRỌNG:
echo  1. Nếu Windows yêu cầu Khởi động lại (Restart), hãy khởi động lại máy.
echo  2. Sau khi khởi động lại, mở Docker Desktop từ Start Menu để hoàn tất thiết lập ban đầu.
echo  3. Sau đó quay lại thư mục này và chạy: 2_Chạy_Server_Docker.bat
echo =====================================================================
pause
