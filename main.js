const { app, BrowserWindow, ipcMain, dialog, globalShortcut, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');
const https = require('https');
const mm    = require('music-metadata');

// node-id3 is optional — only needed for tag writing on MP3s
let NodeID3 = null;
try { NodeID3 = require('node-id3'); } catch (_) {}

let mainWindow;
let miniWindow = null;
const watchers = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
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

app.whenReady().then(() => {
  createWindow();
  restoreWatchedFolders();
  registerMediaKeys();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// ── Media keys ────────────────────────────────────────────────────────────────

function registerMediaKeys() {
  const fwd = ch => {
    if (mainWindow) mainWindow.webContents.send(ch);
    if (miniWindow) miniWindow.webContents.send(ch);
  };
  globalShortcut.register('MediaPlayPause',     () => fwd('media-play-pause'));
  globalShortcut.register('MediaNextTrack',     () => fwd('media-next'));
  globalShortcut.register('MediaPreviousTrack', () => fwd('media-prev'));
}

// ── File dialog ───────────────────────────────────────────────────────────────

ipcMain.handle('open-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'flac', 'ogg', 'wav', 'aac', 'm4a'] }],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('open-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (result.canceled) return [];
  const folderPath = result.filePaths[0];
  watchFolder(folderPath);
  return collectAudioFiles(folderPath);
});

// ── Folder watching ───────────────────────────────────────────────────────────

function watchFolder(folderPath) {
  if (watchers.has(folderPath)) return;
  const AUDIO_EXTS   = new Set(['.mp3', '.flac', '.ogg', '.wav', '.aac', '.m4a']);
  const debounceMap  = new Map();

  const watcher = fs.watch(folderPath, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    if (!AUDIO_EXTS.has(path.extname(filename).toLowerCase())) return;
    if (debounceMap.has(filename)) clearTimeout(debounceMap.get(filename));
    debounceMap.set(filename, setTimeout(() => {
      debounceMap.delete(filename);
      const fullPath = path.join(folderPath, filename);
      if (fs.existsSync(fullPath)) mainWindow?.webContents.send('folder-file-added', fullPath);
    }, 300));
  });

  watcher.on('error', () => { watchers.delete(folderPath); saveWatchedFolders(); });
  watchers.set(folderPath, watcher);
  saveWatchedFolders();
}

ipcMain.on('unwatch-folder', (_e, folderPath) => {
  const w = watchers.get(folderPath);
  if (w) { w.close(); watchers.delete(folderPath); }
});

ipcMain.handle('scan-watched-folders', (_e, knownPaths) => {
  const known   = new Set(knownPaths);
  const newFiles = [];
  for (const fp of watchers.keys())
    for (const f of collectAudioFiles(fp))
      if (!known.has(f)) newFiles.push(f);
  return newFiles;
});

function collectAudioFiles(dir) {
  const EXTS = new Set(['.mp3', '.flac', '.ogg', '.wav', '.aac', '.m4a']);
  let files = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files = files.concat(collectAudioFiles(full));
      else if (EXTS.has(path.extname(entry.name).toLowerCase())) files.push(full);
    }
  } catch (_) {}
  return files;
}

// ── Metadata ──────────────────────────────────────────────────────────────────

ipcMain.handle('read-metadata', async (_e, filePath) => {
  try {
    const meta = await mm.parseFile(filePath, { skipCovers: false });
    const { common, format } = meta;
    let albumArt = null;
    if (common.picture?.length) {
      const pic = common.picture[0];
      albumArt = `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`;
    }
    return {
      filePath,
      title:    common.title  || path.basename(filePath, path.extname(filePath)),
      artist:   common.artist || 'Unknown Artist',
      album:    common.album  || 'Unknown Album',
      year:     common.year   || null,
      genre:    common.genre  ? common.genre[0] : null,
      track:    common.track?.no || 0,
      duration: format.duration || 0,
      albumArt,
    };
  } catch {
    return {
      filePath,
      title:  path.basename(filePath, path.extname(filePath)),
      artist: 'Unknown Artist', album: 'Unknown Album',
      year: null, genre: null, track: 0, duration: 0, albumArt: null,
    };
  }
});

// Open image file dialog and return as base64 data URL
ipcMain.handle('open-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
  });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  const buf  = fs.readFileSync(filePath);
  const ext  = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return `data:${mime};base64,${buf.toString('base64')}`;
});

// Write ID3 tags (MP3 only via node-id3)
ipcMain.handle('write-tags', (_e, filePath, tags) => {
  if (!NodeID3) return { ok: false, error: 'node-id3 is not installed. Run npm install in the app folder.' };
  if (path.extname(filePath).toLowerCase() !== '.mp3')
    return { ok: false, error: 'Tag writing is only supported for MP3 files.' };
  try {
    const payload = {
      title:  tags.title,
      artist: tags.artist,
      album:  tags.album,
      year:   tags.year ? String(tags.year) : undefined,
      genre:  tags.genre,
    };

    // Write album art if provided as a data URL
    if (tags.albumArt && tags.albumArt.startsWith('data:')) {
      const [header, b64] = tags.albumArt.split(',');
      const mime = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
      payload.image = {
        mime,
        type: { id: 3, name: 'front cover' },
        description: 'Cover',
        imageBuffer: Buffer.from(b64, 'base64'),
      };
    }

    const result = NodeID3.update(payload, filePath);
    return { ok: result !== false };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Read .lrc lyrics file next to audio file
ipcMain.handle('read-lrc', (_e, audioPath) => {
  const lrcPath = audioPath.replace(/\.[^.]+$/, '') + '.lrc';
  try { return fs.readFileSync(lrcPath, 'utf8'); } catch { return null; }
});

// ── Library / session persistence ────────────────────────────────────────────

const userDataFile = name => path.join(app.getPath('userData'), name);

ipcMain.handle('save-library-data', (_e, d) => {
  try { fs.writeFileSync(userDataFile('library-data.json'), JSON.stringify(d)); } catch (_) {}
});
ipcMain.handle('load-library-data', () => {
  try { return JSON.parse(fs.readFileSync(userDataFile('library-data.json'), 'utf8')); }
  catch { return null; }
});

ipcMain.handle('save-session', (_e, d) => {
  try { fs.writeFileSync(userDataFile('session.json'), JSON.stringify(d)); } catch (_) {}
});
ipcMain.handle('load-session', () => {
  try { return JSON.parse(fs.readFileSync(userDataFile('session.json'), 'utf8')); }
  catch { return null; }
});

// Legacy playlist.json (kept for backward compat / migration)
const playlistFile      = () => userDataFile('playlist.json');
const watchedFoldersFile = () => userDataFile('watched-folders.json');

function saveWatchedFolders() {
  try { fs.writeFileSync(watchedFoldersFile(), JSON.stringify([...watchers.keys()])); } catch (_) {}
}
function restoreWatchedFolders() {
  try {
    const folders = JSON.parse(fs.readFileSync(watchedFoldersFile(), 'utf8'));
    folders.filter(f => fs.existsSync(f)).forEach(f => watchFolder(f));
  } catch (_) {}
}

ipcMain.handle('save-playlist', (_e, paths) => {
  try { fs.writeFileSync(playlistFile(), JSON.stringify(paths)); } catch (_) {}
});
ipcMain.handle('load-playlist', () => {
  try {
    const paths = JSON.parse(fs.readFileSync(playlistFile(), 'utf8'));
    return paths.filter(p => fs.existsSync(p));
  } catch { return []; }
});

ipcMain.handle('filter-existing-paths', (_e, paths) => {
  return paths.filter(p => fs.existsSync(p));
});

// ── File operations ───────────────────────────────────────────────────────────

ipcMain.on('show-file', (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

ipcMain.handle('rename-file', (_e, oldPath, newPath) => {
  try { fs.renameSync(oldPath, newPath); return { ok: true, newPath }; }
  catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('export-m3u', async (_e, tracks) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'M3U Playlist', extensions: ['m3u'] }],
    defaultPath: 'playlist.m3u',
  });
  if (result.canceled) return false;
  const lines = ['#EXTM3U'];
  for (const t of tracks) {
    lines.push(`#EXTINF:${Math.round(t.duration || 0)},${t.artist} - ${t.title}`);
    lines.push(t.filePath);
  }
  fs.writeFileSync(result.filePath, lines.join('\n'));
  return true;
});

// ── Album art from MusicBrainz / CoverArtArchive ──────────────────────────────

let _lastMBRequest = 0;

function httpsGet(urlStr, headers = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (!redirectsLeft) { reject(new Error('Too many redirects')); return; }
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(e); return; }
    const opts = { hostname: u.hostname, path: u.pathname + u.search, headers };
    const req = https.get(opts, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        let loc = res.headers.location;
        if (!loc.startsWith('http')) loc = `https://${u.hostname}${loc}`;
        resolve(httpsGet(loc, headers, redirectsLeft - 1));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), ct: res.headers['content-type'] || 'image/jpeg' }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

ipcMain.handle('fetch-cover-art', async (_e, artist, album) => {
  // Rate-limit: 1 req/sec to respect MusicBrainz ToS
  const wait = 1100 - (Date.now() - _lastMBRequest);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastMBRequest = Date.now();

  try {
    const q   = encodeURIComponent(`release:${album} AND artist:${artist}`);
    const res = await httpsGet(
      `https://musicbrainz.org/ws/2/release/?query=${q}&fmt=json&limit=5`,
      { 'User-Agent': 'Rei/1.0 (music player; contact@example.com)' }
    );
    if (res.status !== 200) return null;
    const json = JSON.parse(res.body.toString());
    const mbid = json.releases?.[0]?.id;
    if (!mbid) return null;

    const img = await httpsGet(
      `https://coverartarchive.org/release/${mbid}/front-250`,
      { 'User-Agent': 'Rei/1.0' }
    );
    if (img.status !== 200 || !img.body.length) return null;

    const mime = img.ct.split(';')[0].trim() || 'image/jpeg';
    return `data:${mime};base64,${img.body.toString('base64')}`;
  } catch {
    return null;
  }
});

// ── Mini player window ────────────────────────────────────────────────────────

ipcMain.handle('open-mini-player', () => {
  if (miniWindow) { miniWindow.focus(); return; }
  miniWindow = new BrowserWindow({
    width: 300,
    height: 80,
    resizable: false,
    alwaysOnTop: true,
    frame: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'renderer', 'mini', 'mini-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  miniWindow.loadFile(path.join(__dirname, 'renderer', 'mini', 'mini.html'));
  miniWindow.on('closed', () => {
    miniWindow = null;
    mainWindow?.webContents.send('mini-closed');
  });
});

ipcMain.on('close-mini-player', () => {
  miniWindow?.close();
  miniWindow = null;
});

// Main renderer pushes track / playback state to mini window
ipcMain.on('sync-mini-track', (_e, trackInfo) => {
  miniWindow?.webContents.send('mini-track', trackInfo);
});
ipcMain.on('sync-mini-state', (_e, state) => {
  miniWindow?.webContents.send('mini-state', state);
});

// Mini window controls forwarded back to main renderer
ipcMain.on('mini-control', (_e, action) => {
  mainWindow?.webContents.send(`media-${action}`);
});

// ── Window controls ───────────────────────────────────────────────────────────

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close',    () => mainWindow?.close());
