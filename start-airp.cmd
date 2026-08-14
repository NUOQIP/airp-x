@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto node_missing

node -e "const major=Number(process.versions.node.split('.')[0]); process.exit(major>=22?0:1)"
if errorlevel 1 goto node_old

powershell -NoProfile -Command "try { $response=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:4317/api/health'; if ($response.StatusCode -eq 200) { exit 0 } }; exit 1" >nul 2>nul
if not errorlevel 1 goto already_running

if not exist node_modules (
  echo [Airp X] Installing dependencies...
  call npm ci
  if errorlevel 1 goto failed
)

if exist "data\airp.db" (
  for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "AIRP_BACKUP_STAMP=%%i"
  set "AIRP_STARTUP_BACKUP=data\backups\startup-!AIRP_BACKUP_STAMP!"
  mkdir "!AIRP_STARTUP_BACKUP!" >nul 2>nul
  if not exist "!AIRP_STARTUP_BACKUP!" goto failed
  copy /Y "data\airp.db" "!AIRP_STARTUP_BACKUP!\airp.db" >nul
  if errorlevel 1 goto failed
  if exist "data\airp.db-wal" copy /Y "data\airp.db-wal" "!AIRP_STARTUP_BACKUP!\airp.db-wal" >nul
  if exist "data\airp.db-shm" copy /Y "data\airp.db-shm" "!AIRP_STARTUP_BACKUP!\airp.db-shm" >nul
  echo [Airp X] Startup database backup: !AIRP_STARTUP_BACKUP!
)

echo [Airp X] Preparing local database...
call npm run db:migrate
if errorlevel 1 goto failed
call npm run db:seed
if errorlevel 1 goto failed

echo [Airp X] Building the desktop web app...
call npm run build
if errorlevel 1 goto failed

echo [Airp X] Opening http://127.0.0.1:4317
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:4317'"
call npm run start
goto end

:already_running
echo [Airp X] The app is already running. Opening it now...
start "" "http://127.0.0.1:4317"
goto end

:node_missing
echo Node.js 22 or newer is required. Please install Node.js first.
goto failed

:node_old
echo Your Node.js version is too old. Airp X requires Node.js 22 or newer.
goto failed

:failed
echo.
echo Airp X could not start. Review the message above.
pause

:end
endlocal
