@echo off
title Ultron (dev)
cd /d "%~dp0"

echo.
echo   ULTRON - development build
echo   (For everyday use, open the installed Ultron app instead.)
echo.

REM npm.cmd rather than npm: PowerShell's execution policy blocks npm.ps1.
call npm.cmd run dev

echo.
echo   Ultron has exited.
pause
