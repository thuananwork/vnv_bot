@echo off
chcp 65001 >nul
title Mo Khoa VNV Bot - Go Co Windows SmartScreen
cd /d "%~dp0"
echo ============================================================
echo   DANG GO BO CO CHAN PHAN MEM CUA WINDOWS (SMARTSCREEN)...
echo ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -Path '%~dp0' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue; Write-Host '  [OK] Da go bo thanh cong co chan tap tin Windows!' -ForegroundColor Green"
echo ============================================================
echo   Ban da co the chay VNV-Bot.exe hoac VNV-Bot.bat binh thuong!
echo ============================================================
timeout /t 3 >nul
