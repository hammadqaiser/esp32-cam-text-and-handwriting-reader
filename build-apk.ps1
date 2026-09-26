# One-click build script for ESP32 Text Reader Android APK
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Building ESP32 Text Reader Android APK " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$CurrentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = Join-Path $CurrentDir "esp32-text-app"

if (-not (Test-Path $AppDir)) {
    Write-Host "Error: esp32-text-app directory not found!" -ForegroundColor Red
    exit 1
}

Push-Location $AppDir

# 1. Build Vite web assets
Write-Host "[1/3] Compiling web application..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Vite build failed!" -ForegroundColor Red
    Pop-Location
    exit 1
}

# 2. Sync with Capacitor
Write-Host "[2/3] Syncing assets with Capacitor Android..." -ForegroundColor Yellow
npx cap sync android
if ($LASTEXITCODE -ne 0) {
    Write-Host "Capacitor sync failed!" -ForegroundColor Red
    Pop-Location
    exit 1
}

# 3. Assemble APK using JDK 17
Write-Host "[3/3] Building APK with Gradle..." -ForegroundColor Yellow
$env:JAVA_HOME = "C:\Program Files\Java\jdk-17"
Push-Location "android"
.\gradlew.bat assembleDebug
if ($LASTEXITCODE -ne 0) {
    Write-Host "Gradle assembleDebug failed!" -ForegroundColor Red
    Pop-Location
    Pop-Location
    exit 1
}
Pop-Location

$ApkSource = "android\app\build\outputs\apk\debug\app-debug.apk"
$ApkTarget = Join-Path $CurrentDir "ESP32-Text-Reader.apk"
Copy-Item $ApkSource $ApkTarget -Force

Pop-Location

Write-Host "=========================================" -ForegroundColor Green
Write-Host " APK BUILD SUCCESSFUL! " -ForegroundColor Green
Write-Host " Output APK: $ApkTarget" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
