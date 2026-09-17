@echo off
title MOON LIGHT - Inicio
cd /d "%~dp0"
start "" /min cmd /c "node server.js > moonlight.log 2>&1"
echo Esperando a que MOON LIGHT este listo...
set /a tries=0
:wait
timeout /t 1 /nobreak >nul
set /a tries+=1
powershell -NoProfile -Command "try{$r=Invoke-WebRequest -Uri http://localhost:3000 -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){exit 0}else{exit 1}}catch{exit 1}" >nul 2>&1
if errorlevel 1 (
  if %tries% lss 20 goto wait
  echo [ERROR] El servidor no arranco. Abre moonlight.log para ver el motivo.
  pause
  exit /b 1
)
echo MOON LIGHT en linea ✓
start "" "http://localhost:3000"
exit /b 0