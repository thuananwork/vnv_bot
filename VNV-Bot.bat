@echo off
chcp 65001 >nul
title VNV Bot V2 - Trinh Khoi Dong
cd /d "%~dp0"

rem Tu dong go bo co chan download cua Windows (Mark of the Web / SmartScreen) cho toan bo thu muc
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue" >nul 2>nul

rem 0. Tu dong dinh vi thu muc chua ma nguon neu nguoi dung keo file ra ngoai
if not exist "src\index.js" (
    if exist "VNV-Bot-v2.0.0\src\index.js" (
        cd /d "%~dp0VNV-Bot-v2.0.0"
    ) else if exist "vnv_bot\src\index.js" (
        cd /d "%~dp0vnv_bot"
    )
)

rem 1. Kiem tra Node.js portable dong goi san (kiem tra dung luong > 40MB de tranh chay file loi)
if exist "bin\node.exe" (
    for %%F in ("bin\node.exe") do (
        if %%~zF lss 40000000 (
            del /f /q "bin\node.exe" >nul 2>nul
        )
    )
)
if exist "bin\node.exe" (
    "bin\node.exe" -v >nul 2>nul
    if not errorlevel 1 (
        set "NODE_EXE=bin\node.exe"
        goto :FOUND_NODE
    ) else (
        del /f /q "bin\node.exe" >nul 2>nul
    )
)
if exist "node.exe" (
    "node.exe" -v >nul 2>nul
    if not errorlevel 1 (
        set "NODE_EXE=node.exe"
        goto :FOUND_NODE
    )
)

rem 2. Kiem tra Node.js da cai san tren he thong (Program Files hoac PATH)
if exist "%ProgramFiles%\nodejs\node.exe" (
    "%ProgramFiles%\nodejs\node.exe" -v >nul 2>nul
    if not errorlevel 1 (
        set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
        goto :FOUND_NODE
    )
)
if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
    "%ProgramFiles(x86)%\nodejs\node.exe" -v >nul 2>nul
    if not errorlevel 1 (
        set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
        goto :FOUND_NODE
    )
)
where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    node -v >nul 2>nul
    if not errorlevel 1 (
        set "NODE_EXE=node"
        goto :FOUND_NODE
    )
)

rem 3. Neu may chua he co Node.js (may Truong Vung moi), tu dong tai Node.js portable
echo ============================================================
echo   Chua tim thay Node.js tuong thich. Dang tu dong tai Node.js...
echo   (Tien trinh nay chi tai 1 lan duy nhat)
echo ============================================================
if not exist "bin" mkdir bin
set "NODE_ARCH=win-x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="x86" if not defined PROCESSOR_ARCHITEW6432 set "NODE_ARCH=win-x86"
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $ProgressPreference = 'SilentlyContinue'; Write-Host '  Dang tai node.exe tu nodejs.org...'; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v24.15.0/%NODE_ARCH%/node.exe' -OutFile 'bin\node.exe' -UseBasicParsing"

if exist "bin\node.exe" (
    set "NODE_EXE=bin\node.exe"
    echo   Tai Node.js thanh cong!
    goto :FOUND_NODE
)

echo ============================================================
echo   LOI: Khong the tu dong tai Node.js (loi ket noi mang).
echo   Vui long cai dat Node.js tu: https://nodejs.org
echo ============================================================
pause
exit /b 1

:FOUND_NODE
rem Giai phong cong 3000 neu co tien trinh chiem dung truoc do
set "KILLED_PREV="
for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr :3000 ^| findstr LISTENING 2^>nul') do (
    taskkill /f /pid %%a >nul 2>nul
    set "KILLED_PREV=1"
)
if defined KILLED_PREV (
    timeout /t 1 /nobreak >nul 2>nul
)

if not exist "data" mkdir data
if not exist "logs" mkdir logs
if not exist "backups" mkdir backups

echo ============================================================
echo   VNV Bot V2 dang khoi dong...
echo   Dia chi Dashboard: http://localhost:3000
echo   Trinh duyet se tu dong mo len trong giay lat...
echo   Meo: De dung Bot, ban chi can dong cua so lenh nay (hoac bam Ctrl+C).
echo ============================================================

rem Khoi chay may chu VNV Bot (trinh duyet se tu dong mo ngay khi may chu san sang)
set "NODE_OPTIONS=--dns-result-order=ipv4first"
"%NODE_EXE%" src/index.js

if %ERRORLEVEL% neq 0 (
    echo.
    echo ============================================================
    echo   May chu da dung.
    echo ============================================================
)