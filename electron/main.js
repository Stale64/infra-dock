'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const services = require('./services');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 880,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---- IPC wiring ---------------------------------------------------------

function wrap(handler) {
  return async (_event, ...args) => {
    try {
      const data = await handler(...args);
      return { ok: true, data };
    } catch (err) {
      return {
        ok: false,
        error: err.message || String(err),
        detail: (err.stderr || err.stdout || '').toString().trim() || null,
      };
    }
  };
}

ipcMain.handle('services:list', wrap(() => services.listServices()));
ipcMain.handle('services:control', wrap((action, formula) => services.controlService(action, formula)));
ipcMain.handle('services:install', wrap((formula, tap) => services.installService(formula, tap)));
ipcMain.handle('config:read', wrap((p) => services.readConfig(p)));
ipcMain.handle('config:write', wrap((p, content) => services.writeConfig(p, content)));
ipcMain.handle('logs:read', wrap((p) => services.readLogs(p)));
ipcMain.handle('system:info', wrap(() => services.systemInfo()));

ipcMain.handle('shell:openPath', wrap(async (p) => {
  const res = await shell.openPath(p);
  if (res) throw new Error(res);
  return true;
}));

ipcMain.handle('shell:reveal', wrap(async (p) => {
  shell.showItemInFolder(p);
  return true;
}));

// ---- App lifecycle ------------------------------------------------------

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
