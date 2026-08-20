@echo off
title Ultron
cd /d "%~dp0"

echo.
echo   ULTRON - starting up
echo.

REM Ultron needs the Ollama daemon for its brain. Start it if it is not up.
curl -s -m 3 http://localhost:11434/api/tags >nul 2>&1
if errorlevel 1 (
  echo   Ollama is not running - starting it...
  start "" "%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
  timeout /t 5 /nobreak >nul
) else (
  echo   Ollama is already running.
)

echo   Launching the HUD...
echo.

REM npm.cmd rather than npm: PowerShell's execution policy blocks npm.ps1.
call npm.cmd run dev

echo.
echo   Ultron has exited.
pause
