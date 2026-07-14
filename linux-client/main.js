const { app, BrowserWindow } = require('electron');
const path = require('path');

// Disable WebRTC local IP masking to expose all host interfaces and solve multi-IP routing
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');

function createWindow() {
  const win = new BrowserWindow({
    width: 1020,
    height: 820,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    title: "BlaxDrive"
  });

  win.setMenuBarVisibility(false);

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, 'dist/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
