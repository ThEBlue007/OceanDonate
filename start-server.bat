@echo off
title OceanDonate Launcher
echo ==============================================
echo   OceanDonate - Starting MongoDB and Server
echo ==============================================

netstat -ano | findstr :27017 >nul
if %errorlevel% neq 0 (
    echo [*] Starting local MongoDB server...
    start /b "" "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" --dbpath "%USERPROFILE%\.mongo_data" --bind_ip 127.0.0.1
    timeout /t 2 /nobreak >nul
) else (
    echo [OK] MongoDB is already running on port 27017!
)

echo [*] Starting OceanDonate Server...
cd /d "%~dp0\Backend"
node server.js
pause
