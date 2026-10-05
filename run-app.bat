@echo off
chcp 65001 >nul
echo ========================================
echo   شورى - Shura AI Chat App
echo ========================================
echo.
echo Starting Tauri dev server...
echo.

pnpm tauri dev

if %errorlevel% neq 0 (
    echo.
    echo ========================================
    echo   Error: Failed to start the app
    echo ========================================
    echo.
    pause
)
