'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Secure bridge between the sandboxed renderer and the main process.
 * The renderer can only call this fixed set of channels; it has no direct
 * access to Node, the filesystem or child_process.
 */
contextBridge.exposeInMainWorld('infraDock', {
  listServices: () => ipcRenderer.invoke('services:list'),
  control: (action, formula) => ipcRenderer.invoke('services:control', action, formula),
  install: (formula, tap) => ipcRenderer.invoke('services:install', formula, tap),
  readConfig: (path) => ipcRenderer.invoke('config:read', path),
  writeConfig: (path, content) => ipcRenderer.invoke('config:write', path, content),
  readLogs: (path) => ipcRenderer.invoke('logs:read', path),
  systemInfo: () => ipcRenderer.invoke('system:info'),
  openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
  reveal: (path) => ipcRenderer.invoke('shell:reveal', path),
});
