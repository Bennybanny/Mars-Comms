@echo off
setlocal
title Mars Comms
cd /d "%~dp0"

echo ========================================
echo              MARS COMMS
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>nul
if errorlevel 1 goto missing_node

rem Open an existing launcher instead of starting a second server.
powershell.exe -NoProfile -Command "try { $s = Invoke-RestMethod -Uri 'http://127.0.0.1:8091/status' -TimeoutSec 2; if ($null -ne $s.running -and $null -ne $s.interfaces) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
    start "" "http://127.0.0.1:8091"
    exit /b 0
)

if not exist "node_modules\.bin\tsx.cmd" goto install
if not exist "node_modules\.bin\vite.cmd" goto install
goto build

:install
echo Installiere Abhaengigkeiten. Beim ersten Start ist Internet erforderlich.
call npm.cmd ci
if errorlevel 1 goto failed

:build
echo Bereite Mars Comms vor...
call npm.cmd run build
if errorlevel 1 goto failed

echo.
echo Launcher: http://127.0.0.1:8091
echo Bitte dieses Fenster waehrend der Nutzung offen lassen.
echo Zum Beenden Strg+C druecken.
echo.

rem Wait for the launcher in a hidden helper, then open the browser.
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "for ($attempt = 0; $attempt -lt 60; $attempt++) { try { $s = Invoke-RestMethod -Uri 'http://127.0.0.1:8091/status' -TimeoutSec 1; if ($null -ne $s.running -and $null -ne $s.interfaces) { Start-Process 'http://127.0.0.1:8091'; exit } } catch {}; Start-Sleep -Milliseconds 500 }"
call npm.cmd start
if errorlevel 1 goto failed
exit /b 0

:missing_node
echo FEHLER: Bitte Node.js 24 LTS oder neuer inklusive npm installieren.
echo Download: https://nodejs.org/
echo Danach diese Datei erneut starten.
pause
exit /b 1

:failed
echo.
echo Mars Comms konnte nicht gestartet werden. Siehe Fehlermeldung oben.
pause
exit /b 1
