@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto node_missing

node -e "const major=Number(process.versions.node.split('.')[0]); process.exit(major>=22?0:1)"
if errorlevel 1 goto node_old

if not exist node_modules (
  echo [Airp X] Installing dependencies...
  call npm install
  if errorlevel 1 goto failed
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
