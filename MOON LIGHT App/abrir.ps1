$ErrorActionPreference = 'SilentlyContinue'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir

# 1) Arranca el servidor local si no esta corriendo
$up = $false
try {
  $r = Invoke-WebRequest -Uri 'http://localhost:3000/' -UseBasicParsing -TimeoutSec 2
  if ($r.StatusCode -eq 200) { $up = $true }
} catch { $up = $false }
if (-not $up) {
  Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',"Set-Location '$root'; & node server.js *> '$root\moonlight.log'"
  Start-Sleep -Seconds 6
}

# 2) Abre MOON LIGHT en ventana propia (sin pestanas), como una app
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$profile = Join-Path $scriptDir 'perfil'
if ($browser -match 'edge') { $profile = Join-Path $scriptDir 'perfil-edge' }

if ($browser) {
  $cmd = "--app=http://localhost:3000 --user-data-dir=`"$profile`" --start-minimized --disable-background-timer-throttling --disable-renderer-backgrounding --window-size=1330,850 --window-position=center"
  Start-Process $browser -ArgumentList $cmd
} else {
  Start-Process 'http://localhost:3000'
}