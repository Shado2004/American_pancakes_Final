@echo off
setlocal

echo ================================================================
echo   Starting American Pancakes POS
echo ================================================================
echo.

:: 1. Clear any lingering background dev ports (3001, 3002, 3003)
if exist kill-ports.js (
    node kill-ports.js 3001 3002 3003 >nul 2>nul
)

:: 2. Check if build exists, otherwise compile
if not exist "dist\main\index.js" (
    echo [INFO] Built backend not detected. Running build first...
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Build failed. Please run setup.bat first.
        pause
        exit /b 1
    )
)

:: 3. Launch Electron POS application
echo [INFO] Launching Electron POS Desktop Window...
call npx electron .
