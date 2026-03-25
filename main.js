const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const mm = require('music-metadata');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 720,
    minHeight: 500,
    backgroundColor: '#121212',
    titleBarStyle: 'hiddenInset',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Open file dialog and return selected audio file paths
ipcMain.handle('open-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Audio Files',
        extensions: ['mp3', 'flac', 'ogg', 'wav', 'aac', 'm4a'],
      },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

// Open a folder and return all audio files within it (recursive)
ipcMain.handle('open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled) return [];
  return collectAudioFiles(result.filePaths[0]);
});

function collectAudioFiles(dir) {
  const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.wav', '.aac', '.m4a']);
  let files = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(collectAudioFiles(full));
      } else if (AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) {
        files.push(full);
      }
    }
  } catch (_) {}
  return files;
}

// Read metadata for a single file
ipcMain.handle('read-metadata', async (_event, filePath) => {
  try {
    const meta = await mm.parseFile(filePath, { skipCovers: false });
    const { common, format } = meta;

    let albumArt = null;
    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      albumArt = `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`;
    }

    return {
      filePath,
      title: common.title || path.basename(filePath, path.extname(filePath)),
      artist: common.artist || 'Unknown Artist',
      album: common.album || 'Unknown Album',
      year: common.year || null,
      genre: common.genre ? common.genre[0] : null,
      duration: format.duration || 0,
      albumArt,
    };
  } catch (err) {
    return {
      filePath,
      title: path.basename(filePath, path.extname(filePath)),
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      year: null,
      genre: null,
      duration: 0,
      albumArt: null,
    };
  }
});

// Playlist persistence
const playlistFile = () => path.join(app.getPath('userData'), 'playlist.json');

ipcMain.handle('save-playlist', (_event, filePaths) => {
  try {
    fs.writeFileSync(playlistFile(), JSON.stringify(filePaths));
  } catch (_) {}
});

ipcMain.handle('load-playlist', () => {
  try {
    const data = fs.readFileSync(playlistFile(), 'utf8');
    const paths = JSON.parse(data);
    // Filter out files that no longer exist on disk
    return paths.filter(p => fs.existsSync(p));
  } catch (_) {
    return [];
  }
});

// Window controls
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());
