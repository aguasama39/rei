const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── File dialog ─────────────────────────────────────────────────────────────
  openFiles:          ()             => ipcRenderer.invoke('open-files'),
  openFolder:         ()             => ipcRenderer.invoke('open-folder'),

  // ── Metadata ─────────────────────────────────────────────────────────────────
  readMetadata:       fp             => ipcRenderer.invoke('read-metadata', fp),
  writeTags:          (fp, tags)     => ipcRenderer.invoke('write-tags', fp, tags),
  readLrc:            fp             => ipcRenderer.invoke('read-lrc', fp),
  fetchCoverArt:      (artist, album)=> ipcRenderer.invoke('fetch-cover-art', artist, album),

  // ── Library / session ────────────────────────────────────────────────────────
  saveLibraryData:    d              => ipcRenderer.invoke('save-library-data', d),
  loadLibraryData:    ()             => ipcRenderer.invoke('load-library-data'),
  saveSession:        d              => ipcRenderer.invoke('save-session', d),
  loadSession:        ()             => ipcRenderer.invoke('load-session'),

  // ── Legacy playlist (kept for migration) ─────────────────────────────────────
  savePlaylist:        paths         => ipcRenderer.invoke('save-playlist', paths),
  loadPlaylist:        ()            => ipcRenderer.invoke('load-playlist'),
  filterExistingPaths: paths         => ipcRenderer.invoke('filter-existing-paths', paths),

  // ── File ops ─────────────────────────────────────────────────────────────────
  showFile:           fp             => ipcRenderer.send('show-file', fp),
  renameFile:         (old_, new_)   => ipcRenderer.invoke('rename-file', old_, new_),
  exportM3U:          tracks         => ipcRenderer.invoke('export-m3u', tracks),

  // ── Folder watching ───────────────────────────────────────────────────────────
  scanWatchedFolders: known          => ipcRenderer.invoke('scan-watched-folders', known),
  unwatchFolder:      fp             => ipcRenderer.send('unwatch-folder', fp),
  onFolderFileAdded:  cb             => ipcRenderer.on('folder-file-added', (_e, fp) => cb(fp)),

  // ── Mini player ───────────────────────────────────────────────────────────────
  openMiniPlayer:     ()             => ipcRenderer.invoke('open-mini-player'),
  closeMiniPlayer:    ()             => ipcRenderer.send('close-mini-player'),
  syncMiniTrack:      info           => ipcRenderer.send('sync-mini-track', info),
  syncMiniState:      state          => ipcRenderer.send('sync-mini-state', state),
  onMiniClosed:       cb             => ipcRenderer.on('mini-closed', cb),
  onMiniControl:      cb             => {
    ipcRenderer.on('media-play-pause', () => cb('play-pause'));
    ipcRenderer.on('media-next',       () => cb('next'));
    ipcRenderer.on('media-prev',       () => cb('prev'));
  },

  // ── Media keys ────────────────────────────────────────────────────────────────
  onMediaKey: cb => {
    ipcRenderer.on('media-play-pause', () => cb('play-pause'));
    ipcRenderer.on('media-next',       () => cb('next'));
    ipcRenderer.on('media-prev',       () => cb('prev'));
  },

  // ── Window controls ───────────────────────────────────────────────────────────
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose:    () => ipcRenderer.send('window-close'),
});
