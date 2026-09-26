# ESP32 Text Reader — Mobile Application (Android & iOS)

This folder contains the cross-platform mobile application powered by **Capacitor 8** and **Vite**. The app connects to the ESP32-CAM Wi-Fi Access Point, streams live camera frames, captures high-resolution snapshots, and recognizes handwritten and printed alphanumeric text completely offline.

---

## Key Features

1. **Dual-Engine OCR Architecture**:
   - **Google ML Kit (Android)**: Native on-device neural network bundled into the APK (`libmlkit_google_ocr_pipeline.so`). Performs text detection first to discard scene clutter (cables, desks, lanyards) and specializes in Latin handwriting.
   - **Apple Vision Framework (iOS)**: Native `VNRecognizeTextRequest` built into iOS 13+. Runs 100% on-device with accurate Latin handwriting recognition and zero external dependencies.
   - **Tesseract.js (Offline Fallback)**: Client-side WebAssembly OCR engine preloaded directly into memory with fast trained language data (`eng.traineddata`).
2. **Interactive Cropper & Focus Box**:
   - Touch/drag handles to isolate words or lines from background clutter.
   - Quick presets: **Card (50%)** for badges and ID cards, and **Full Frame**.
   - **⚡ Scan Crop** button for instant sub-region OCR.
3. **Live Stream & High-Res Snapshot**:
   - Live MJPEG/JPEG stream polling at `1200ms` intervals.
   - High-resolution capture endpoint trigger (`/capture.jpg` or `/cam-hi.jpg`).
4. **Offline Local Network Routing**:
   - Android native process bound to Wi-Fi network interface so cellular data does not hijack requests when connected to the internet-less ESP32 Access Point.
   - Native HTTP client (`@capacitor/core` `CapacitorHttp`) bypasses WebView CORS and Mixed Content restrictions.
5. **Productivity Utilities**:
   - One-tap clipboard copy.
   - Native Text-to-Speech (read recognized text aloud).
   - System share sheet integration.
   - Persistent scan history stored locally with confidence scores.

---

## Directory Layout

```text
esp32-text-app/
├── android/                             # Native Android project (Gradle, JDK 17)
│   └── app/src/main/java/com/esp32/textreader/
│       ├── MainActivity.java            # Network binding & plugin registration
│       └── NativeOcrPlugin.java         # Google ML Kit on-device OCR plugin
├── ios/                                 # Native iOS project (Xcode)
│   └── App/App/
│       ├── AppDelegate.swift
│       ├── Info.plist                   # Cleartext & local network permissions
│       ├── NativeOcrPlugin.swift        # Apple Vision framework OCR plugin
│       └── NativeOcrPlugin.m            # Capacitor Obj-C bridge
├── public/
│   └── tesseract/                       # Offline WebAssembly core & models
│       ├── tesseract-core.wasm.js
│       ├── worker.min.js
│       └── lang-data/eng.traineddata    # Offline fast English model
├── src/
│   ├── main.js                          # Core app logic, stream, cropper, OCR routing
│   └── style.css                        # Modern responsive dark-mode styling
├── capacitor.config.json                # Capacitor configuration
├── index.html                           # Single-page UI layout
├── package.json
└── vite.config.js
```

---

## Building from Source

### Android Build
From repository root on Windows:
```powershell
.\build-apk.ps1
```
Or manually inside `esp32-text-app`:
```bash
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```
Output: `android/app/build/outputs/apk/debug/app-debug.apk`

### iOS Build
```bash
npm run build
npx cap sync ios
```
Open `ios/App/App.xcodeproj` in Xcode on macOS, or push to GitHub to use the automated workflow in `.github/workflows/build-ios.yml`.
