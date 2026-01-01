@echo off
echo ========================================
echo  Starting LiveKit Server (Self-Hosted)
echo ========================================
echo.

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Docker is not running!
    echo.
    echo Please start Docker Desktop first:
    echo https://www.docker.com/products/docker-desktop
    echo.
    pause
    exit /b 1
)

echo Starting LiveKit server...
docker-compose up -d

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo  LiveKit Server is running!
    echo ========================================
    echo.
    echo WebSocket URL: ws://localhost:7880
    echo API Key: devkey
    echo API Secret: secret
    echo.
    echo Now start your Node.js app:
    echo   npm start
    echo.
    echo Then open: http://localhost:3000
    echo ========================================
) else (
    echo.
    echo ERROR: Failed to start LiveKit server
    echo Try running: docker-compose up
)

pause

