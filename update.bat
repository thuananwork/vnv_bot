@echo off
title VNV Bot V2 - Migration & Update Tool
cd /d "%~dp0"

echo.
echo ============================================================
echo   VNV-BOT V2 AUTOMATIC UPDATE & MIGRATION TOOL
echo ============================================================
echo   This tool migrates your SQLite database (vnv_bot.db),
echo   environment config (.env), and Google Credentials.
echo.

set /p OLD_DIR="Enter path to OLD VNV-Bot folder (e.g. D:\vnv_bot_v1.0.0): "
set OLD_DIR=%OLD_DIR:"=%

if not exist "%OLD_DIR%" (
    echo.
    echo [ERROR] Old folder does not exist! Please check the path.
    pause
    exit /b 1
)

set OLD_DB_PATH=""
set OLD_ENV_PATH=""
set OLD_CRED_PATH=""

if exist "%OLD_DIR%\data\vnv_bot.db" (
    set OLD_DB_PATH="%OLD_DIR%\data\vnv_bot.db"
)

if exist "%OLD_DIR%\config\.env" (
    set OLD_ENV_PATH="%OLD_DIR%\config\.env"
) else if exist "%OLD_DIR%\.env" (
    set OLD_ENV_PATH="%OLD_DIR%\.env"
)

if exist "%OLD_DIR%\config\credentials.json" (
    set OLD_CRED_PATH="%OLD_DIR%\config\credentials.json"
) else if exist "%OLD_DIR%\data\credentials.json" (
    set OLD_CRED_PATH="%OLD_DIR%\data\credentials.json"
) else if exist "%OLD_DIR%\credentials.json" (
    set OLD_CRED_PATH="%OLD_DIR%\credentials.json"
)

if %OLD_DB_PATH% == "" if %OLD_ENV_PATH% == "" (
    echo.
    echo [ERROR] Old folder does not contain valid VNV-Bot data or config!
    pause
    exit /b 1
)

echo.
echo [INFO] Detected old version files:
if not %OLD_DB_PATH% == "" echo   - Database: %OLD_DB_PATH%
if not %OLD_ENV_PATH% == "" echo   - Config env: %OLD_ENV_PATH%
if not %OLD_CRED_PATH% == "" echo   - Google API Key: %OLD_CRED_PATH%
echo.

for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd_HHmmss'"`) do set TIMESTAMP=%%i
set BACKUP_DIR=backups\before_update_%TIMESTAMP%

echo [INFO] Creating temporary backup at: %BACKUP_DIR%
mkdir "%BACKUP_DIR%" >nul 2>nul
if not exist "%BACKUP_DIR%" (
    echo [ERROR] Cannot create backup folder.
    pause
    exit /b 1
)

if exist "config" xcopy /e /i /y "config" "%BACKUP_DIR%\config" >nul 2>nul
if exist "data" xcopy /e /i /y "data" "%BACKUP_DIR%\data" >nul 2>nul

if not exist "config" mkdir "config"
if not exist "data" mkdir "data"

echo [INFO] Copying files...
set COPY_ERROR=0

if not %OLD_DB_PATH% == "" (
    echo   - Copying vnv_bot.db...
    copy %OLD_DB_PATH% "data\vnv_bot.db" /y >nul
    if %ERRORLEVEL% neq 0 set COPY_ERROR=1
)

if not %OLD_ENV_PATH% == "" (
    echo   - Copying .env into config/.env...
    copy %OLD_ENV_PATH% "config\.env" /y >nul
    if %ERRORLEVEL% neq 0 set COPY_ERROR=1
)

if not %OLD_CRED_PATH% == "" (
    echo   - Copying credentials.json into config/credentials.json...
    copy %OLD_CRED_PATH% "config\credentials.json" /y >nul
    if %ERRORLEVEL% neq 0 set COPY_ERROR=1
)

if %COPY_ERROR% neq 0 (
    echo.
    echo [ERROR] File copy failed! Restoring original files...
    if exist "%BACKUP_DIR%\config" xcopy /e /y "%BACKUP_DIR%\config" "config" >nul 2>nul
    if exist "%BACKUP_DIR%\data" xcopy /e /y "%BACKUP_DIR%\data" "data" >nul 2>nul
    echo [INFO] Restored to initial state.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   [SUCCESS] UPDATE & MIGRATION COMPLETE!
echo ============================================================
echo   - Database migrated to: data/vnv_bot.db
echo   - Configuration stored in: config/.env
echo   - Google API Key stored in: config/credentials.json
echo ============================================================
echo   Please double-click VNV-Bot.bat to launch the app!
echo ============================================================
echo.
pause
exit /b 0
