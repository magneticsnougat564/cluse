const { app, BrowserWindow } = require('electron');
const path = require('path');
const chokidar = require('chokidar');
const { projectsDir, parseAll } = require('./src/usage');

let win;
let watcher;
let debounce;

function createWindow() {
  win = new BrowserWindow({
    width: 580,
    height: 760,
    minWidth: 420,
    minHeight: 480,
    backgroundColor: '#1a1714',
    title: 'Cluse Usage',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function pushUsage() {
  if (!win || win.isDestroyed()) return;
  const records = parseAll();
  win.webContents.send('usage', { records, computedAt: Date.now() });
}

function startWatching() {
  const dir = projectsDir();
  watcher = chokidar.watch(dir, {
    ignoreInitial: true,
    depth: 2,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });
  const onChange = () => {
    clearTimeout(debounce);
    debounce = setTimeout(pushUsage, 800);
  };
  watcher.on('add', onChange).on('change', onChange).on('unlink', onChange);
}

app.whenReady().then(() => {
  createWindow();
  win.webContents.once('did-finish-load', pushUsage);
  startWatching();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (watcher) watcher.close();
  if (process.platform !== 'darwin') app.quit();
});
