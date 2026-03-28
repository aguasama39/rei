const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniApi', {
  onTrack:  cb => ipcRenderer.on('mini-track',  (_, d) => cb(d)),
  onState:  cb => ipcRenderer.on('mini-state',  (_, d) => cb(d)),
  send:  action => ipcRenderer.send('mini-control', action),
  close:    ()  => ipcRenderer.send('close-mini-player'),
});
