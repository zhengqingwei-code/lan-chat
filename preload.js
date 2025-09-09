const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (msg) => ipcRenderer.send('send-message', msg),
  onMessage: (cb) => ipcRenderer.on('chat-message', (_, msg) => cb(msg)),
  onPeer: (cb) => ipcRenderer.on('peer-connected', (_, ip) => cb(ip)),
  onStatus: (cb) => ipcRenderer.on('status-update', (_, status) => cb(status))
});
