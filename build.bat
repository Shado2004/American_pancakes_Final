@echo off
setlocal

echo ================================================================
echo   Building American Pancakes POS (Frontend + Backend)
echo ================================================================
echo.

echo [1/2] Building Next.js frontend bundle...
call npm run build:frontend
if %ERRORLEVEL% neq 0 (
    echo [INFO] Retrying frontend build...
    call npm run build:frontend
)

echo [2/2] Compiling backend TypeScript...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Backend build failed.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [SUCCESS] Build completed successfully!
echo Run 'run.bat' to start the application.
echo.
pause
