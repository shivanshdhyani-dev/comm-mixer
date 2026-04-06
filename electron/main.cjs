const { app, BrowserWindow, session } = require("electron");
const path = require("path");

// Keep a global reference to prevent garbage collection
let mainWindow = null;

const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    title: "CommMixer",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      // Keep WebRTC audio alive when window loses focus
      backgroundThrottling: false,
    },
  });

  // Auto-grant microphone and audio output device permissions
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const allowed = [
        "media",
        "mediaKeySystem",
        "audioCapture",
      ];
      callback(allowed.includes(permission));
    }
  );

  // Also handle permission checks (Chrome's permission query API)
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => {
      if (permission === "media" || permission === "audioCapture") {
        return true;
      }
      return false;
    }
  );

  if (isDev) {
    // Development: load Vite dev server
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    // Production: load built files
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Prevent accidental close — confirm first
  mainWindow.on("close", (e) => {
    // Only block if we want confirmation (can be toggled)
    // For now, allow close without confirmation
  });
}

app.whenReady().then(createWindow);

// macOS: re-create window when dock icon is clicked
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Quit when all windows closed (except macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
