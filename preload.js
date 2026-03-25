const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFiles: () => ipcRenderer.invoke('open-files'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  readMetadata: (filePath) => ipcRenderer.invoke('read-metadata', filePath),
  savePlaylist: (filePaths) => ipcRenderer.invoke('save-playlist', filePaths),
  loadPlaylist: () => ipcRenderer.invoke('load-playlist'),
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
});
