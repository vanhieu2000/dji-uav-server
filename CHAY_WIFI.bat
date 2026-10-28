@echo off
chcp 65001 >nul
setlocal
set LOCAL_NETWORK_MODE=lan
call "%~dp0CHAY_LOCAL.bat"
endlocal
