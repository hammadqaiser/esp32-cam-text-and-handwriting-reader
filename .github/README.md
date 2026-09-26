# Cloud iOS Build Guide (GitHub Actions)

This repository includes an automated GitHub Actions CI/CD workflow located at:
`.github/workflows/build-ios.yml`

This allows you to generate a compiled iOS Application Package (`.ipa`) **completely free using GitHub's cloud macOS runners**, without requiring an Apple Mac computer on your local desk.

---

## How to Build the iOS App

### Step 1: Push Your Code to GitHub
Initialize your Git repository and push this project to your GitHub account (public or private):

```bash
git init
git add .
git commit -m "ESP32 Text Reader: Android and iOS production release"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

### Step 2: Trigger the iOS Build
1. Open your repository on **github.com**.
2. Click on the **Actions** tab at the top.
3. In the left sidebar, click on **Build iOS App**.
4. Click the **Run workflow** dropdown on the right and select the `main` branch.
5. Click the green **Run workflow** button.

### Step 3: Download the Compiled iOS App
1. The GitHub Mac runner will automatically:
   - Check out the code.
   - Install dependencies (`npm ci`).
   - Compile web assets (`npm run build`).
   - Sync the iOS Capacitor project (`npx cap sync ios`).
   - Run `xcodebuild` on macOS to produce the application archive.
   - Package the payload into `ESP32-Text-Reader-unsigned.ipa`.
2. Once the workflow completes (approx. 3–5 minutes), scroll down to the **Artifacts** section at the bottom of the run page.
3. Click **ESP32-Text-Reader-iOS** to download the ready-to-test `.ipa` file!

---

## Installing the `.ipa` onto an iPhone

- **TestFlight / App Store**: If you have an Apple Developer account, configure code signing certificates in Xcode or GitHub Secrets.
- **Sideloading for Testing**: You can install the `.ipa` directly onto any iPhone using tools such as **AltStore**, **Sideloadly**, or Apple Configurator.
