# BlaxDrive // Serverless P2P Private Storage

BlaxDrive is a decentralized, serverless private storage access system that allows you to explore, download, upload, and manage files on your Android device directly from a Linux PC using secure WebRTC Data Channels. Signaling is handled out-of-band via a temporary broker using an instant 6-digit PIN.

---

## 🔒 Features

- **Direct P2P Link**: High-speed, secure direct data channel connections using WebRTC—no central cloud storage or middlemen.
- **Instant Pairing**: Enter a 6-digit PIN code to establish a link. No accounts, QR codes, or camera access required.
- **Biometric / Lock Screen Security**: The Android app is secured using your phone's native lock credentials (fingerprint, face, PIN, pattern, or password) on launch and background resume.
- **Background Persistence**: A background foreground service keeps sharing active on Android even if you lock the device or swipe the app closed.
- **Monospace Terminal Aesthetic**: Clean, responsive styling.
- **Full Storage Operations**: Navigate directories, download files in binary slices, create files/folders, delete items, and upload files via drag-and-drop.

---

## 🛠️ Download & Build Manual

### 📱 Android Companion App (`android-client`)

#### Prerequisites
- Flutter SDK (version 3.19+ recommended)
- Java JDK 17
- Android SDK

#### Building from Source
1. Navigate to the Android client folder:
   ```bash
   cd android-client
   ```
2. Retrieve packages:
   ```bash
   flutter pub get
   ```
3. Compile the production release APK:
   ```bash
   flutter build apk --release
   ```
4. Find the built APK at:
   `build/app/outputs/flutter-apk/app-release.apk`
5. Install on your Android device:
   ```bash
   adb install build/app/outputs/flutter-apk/app-release.apk
   ```

---

### 💻 Linux Desktop App (`linux-client`)

#### Prerequisites
- Node.js (v18+)
- npm

#### Building & Running
1. Navigate to the Linux client folder:
   ```bash
   cd linux-client
   ```
2. Install npm dependencies:
   ```bash
   npm install
   ```
3. Build production assets:
   ```bash
   npm run build
   ```
4. Run the desktop application launcher:
   ```bash
   ./blaxdrive-launcher.sh
   ```

---

## 📖 User Manual

### Step 1: Unlock and Start Sharing
1. Launch the **BlaxDrive** app on your Android phone.
2. Authenticate using your phone's lock screen password, PIN, pattern, or biometrics.
3. Click the **`[ Start Sharing ]`** button.
4. A random 6-digit PIN code will generate and display on the screen immediately.

### Step 2: Establish the Connection
1. Launch the **BlaxDrive** desktop app on your Linux PC.
2. Enter the 6-digit PIN code displayed on the Android screen.
3. Press Enter or click **`[ ESTABLISH LINK ]`**.
4. The system will handshake over the temporary signaling broker and establish a direct WebRTC connection.

### Step 3: Manage Your Storage
* **Navigate**: Double-click or click **`[Open]`** next to a directory to enter it.
* **Download**: Click **`[Download]`** next to any file. The file is sliced, piped over the WebRTC data channel, and saved to your downloads path.
* **Create Folder/File**: Click **`[ + New Folder ]`** or **`[ + New File ]`** at the top right, enter the name in the prompt, and click Confirm.
* **Upload**: Drag files from your Linux file explorer and drop them anywhere inside the main explorer panel to upload them to the current directory path.
* **Delete**: Click **`[Delete]`** next to a file or folder to permanently delete it.
* **Disconnect**: Click **`[ Disconnect ]`** to close the session.

---

## 👥 Authors
* Developed by Saumyajit
