# 🌌 BlaxDrive

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Flutter](https://img.shields.io/badge/Flutter-02569B?style=flat&logo=flutter&logoColor=white)](https://flutter.dev)
[![Electron](https://img.shields.io/badge/Electron-47848F?style=flat&logo=electron&logoColor=white)](https://www.electronjs.org)
[![WebRTC](https://img.shields.io/badge/WebRTC-333333?style=flat&logo=webrtc&logoColor=white)](https://webrtc.org)

**BlaxDrive** is a premium, secure, and minimalist Peer-to-Peer (P2P) storage and file-sharing bridge. It establishes a direct WebRTC link between your Linux PC and Android phone, enabling lightning-fast transfers across any network without uploading your data to third-party cloud servers.

---

## ✨ Features

*   **🔒 Pure P2P Security:** Direct data channel connection using WebRTC. Your files never touch the cloud.
*   **📡 Cross-Network Connectivity:** Streamlined STUN/TURN traversal works seamlessly across different Wi-Fi networks, mobile data, and firewalls.
*   **🔑 System Passcode Authentication:** Protected by Android's native Lock Screen Shield (PIN, Pattern, Password, or Biometrics) before allowing access.
*   **📌 Persistent Unique PIN:** Each device displays a static, persistent 6-digit pairing PIN, removing the friction of scanning QR codes.
*   **🔋 Background Execution:** The Android application runs as a foreground service with a persistent notification, ensuring sharing remains active even when the app is closed.

---

## 📥 Download & Installation Manual

### 📱 Android Mobile Client

#### Option 1: Quick Install (Recommended)
You can directly copy the precompiled production APK from the build directory to your phone:
*   **Path to APK:** `android-client/build/app/outputs/flutter-apk/app-release.apk`
*   Transfer this file to your phone and open it to install the application.

#### Option 2: Build from Source
If you wish to compile the mobile client yourself:
1.  Install the [Flutter SDK](https://docs.flutter.dev/get-started/install).
2.  Enable Developer Options and USB Debugging on your Android phone.
3.  Connect your phone to your PC via USB.
4.  Navigate to the directory and install dependencies:
    ```bash
    cd android-client
    flutter pub get
    ```
5.  Run/install the application on your connected device:
    ```bash
    flutter run --release
    ```

---

### 💻 Linux/Desktop Client

#### Build and Run the App
1.  Ensure you have [Node.js](https://nodejs.org/) installed.
2.  Navigate to the `linux-client` directory:
    ```bash
    cd linux-client
    ```
3.  Install dependencies:
    ```bash
    npm install
    ```
4.  Start the Electron desktop client:
    ```bash
    npm run dev
    ```

---

## 📖 User Manual & Pairing Guide

Follow these steps to establish a connection and begin sharing files:

### Step 1: Open and Authenticate on Mobile
1.  Launch **BlaxDrive** on your Android device.
2.  Verify your identity using your phone's lock screen security credentials (PIN, fingerprint, face, or pattern).
3.  The app will display your **Unique 6-digit PIN**.

### Step 2: Start Sharing
1.  Tap **`Start Sharing`** on your phone.
2.  The app will generate a secure WebRTC offer and display a notification confirming that sharing is running in the background.

### Step 3: Connect on your PC
1.  Open the **BlaxDrive** desktop app on your Linux PC.
2.  Enter the **6-digit PIN** shown on your phone's screen.
3.  Click **`ESTABLISH LINK`**.
4.  Once paired, you can view your phone's storage tree, download files, create folders, and upload files directly from your PC!
