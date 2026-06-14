const { app, BrowserWindow, ipcMain, utilityProcess } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let serverProcess = null;
let mainWindow = null;

// File logging for packaged app diagnostics
const logFile = path.join(app.getPath('userData'), 'main-process.log');
function log(msg) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
    console.log(msg);
  } catch (e) {
    console.error('Failed to write log:', e);
  }
}

// Disable auto-download of updates so the user is prompted first
autoUpdater.autoDownload = false;

function startBackendServer() {
  const serverPath = path.join(__dirname, 'backend', 'server.js');
  log(`Spawning backend server from path: ${serverPath}`);
  
  try {
    // Spawn backend using Electron's utilityProcess to support ASAR execution
    serverProcess = utilityProcess.fork(serverPath, [], {
      env: {
        ...process.env,
        AETHER_USER_DATA_PATH: app.getPath('userData'),
        PORT: '5000',
        NODE_ENV: app.isPackaged ? 'production' : 'development'
      },
      stdio: 'inherit'
    });

    serverProcess.on('spawn', () => {
      log('Backend server process spawned successfully.');
    });

    serverProcess.on('exit', (code) => {
      log(`Backend server exited with code ${code}`);
    });
  } catch (err) {
    log(`Failed to fork backend server: ${err.message}`);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Aether Trading Bot',
    icon: path.join(__dirname, 'frontend', 'public', 'favicon.ico'), // Fallback if icon exists
    backgroundColor: '#0a0b0d', // Match backend/frontend dark theme
    webPreferences: {
      nodeIntegration: false,
      contextBridge: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Remove default menu bar
  mainWindow.removeMenu();

  // Load URL based on environment
  if (app.isPackaged || process.env.AETHER_TEST_PROD === 'true') {
    mainWindow.loadURL('http://localhost:5000');
  } else {
    // In dev mode, load Vite dev server
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Ensure backend is killed when app exits
function killBackend() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

app.whenReady().then(() => {
  startBackendServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Setup auto-updater listeners
  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus('Update available', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    sendUpdateStatus('Update not available');
  });

  autoUpdater.on('error', (err) => {
    sendUpdateStatus('Error in auto-updater: ' + err.toString());
  });

  autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    sendUpdateStatus(log_message);
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus('Update downloaded');
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded');
    }
  });

  // Check for updates after window loads
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      console.error('Error checking for updates:', err);
    });
  }, 5000);
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  killBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  killBackend();
});

// IPC communication helper
function sendUpdateStatus(message, version = '') {
  console.log(`[Auto-Updater] ${message} ${version}`);
  if (mainWindow) {
    mainWindow.webContents.send('updater-log', { message, version });
  }
}

// User clicked "Update Now" in UI
ipcMain.on('start-download', () => {
  autoUpdater.downloadUpdate();
});

// User clicked "Install Now" in UI
ipcMain.on('quit-and-install', () => {
  autoUpdater.quitAndInstall();
});
