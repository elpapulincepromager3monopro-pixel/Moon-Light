@echo off
title MOON LIGHT - Cerrar APP
taskkill /f /im node.exe >nul 2>&1
echo MOON LIGHT APP detenido.
timeout /t 2 /nobreak >nul
exit /b 0