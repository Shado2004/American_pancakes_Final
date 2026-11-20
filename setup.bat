@echo off
setlocal enabledelayedexpansion

echo ================================================================
echo   American Pancakes POS - Automated Setup for Windows
echo ================================================================
echo.

:: 1. Verify Node.js installation
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not found in PATH!
    echo Please install Node.js 22 LTS (recommended: >= 22.12.0) from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: 2. Show detected Node.js & npm version
echo [INFO] Detected Node.js environment:
node -v
call npm -v
echo.

:: 3. Install root dependencies (Electron, backend, better-sqlite3)
echo [1/4] Installing backend and Electron dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Root npm install failed.
    pause
    exit /b %ERRORLEVEL%
)
echo.

:: 4. Install frontend Next.js dependencies
echo [2/4] Installing Next.js frontend dependencies...
cd frontend
call npm install
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Frontend npm install failed.
    cd ..
    pause
    exit /b %ERRORLEVEL%
)
cd ..
echo.

:: 5. Build frontend static assets
echo [3/4] Building Next.js frontend production bundle...
call npm run build:frontend
if %ERRORLEVEL% neq 0 (
    echo [INFO] Retrying frontend build...
    call npm run build:frontend
)
echo.

:: 6. Build backend TypeScript into dist/
echo [4/4] Compiling backend TypeScript into dist/...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Backend TypeScript compilation failed.
    pause
    exit /b %ERRORLEVEL%
)
echo.

echo ================================================================
echo   [SUCCESS] Setup completed successfully!
echo   Double-click 'run.bat' to start the POS desktop application.
echo ================================================================
echo.
pause
