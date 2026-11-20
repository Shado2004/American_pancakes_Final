@echo off
setlocal

echo ================================================================
echo   Starting American Pancakes POS (Web Browser Mode)
echo ================================================================
echo.
echo Launching Next.js frontend server...
echo The application will be available at: http://localhost:3000
echo.
echo Press Ctrl+C in this terminal window to stop the server.
echo.

cd frontend
call npm run dev
