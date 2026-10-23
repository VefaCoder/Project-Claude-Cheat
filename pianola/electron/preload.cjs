// Exposes a small, explicit API to the renderer. Everything goes through IPC to the main process.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pianola', {
  platform: process.platform,
  saveText: (name, content) => ipcRenderer.invoke('file:save', name, content),
  openText: () => ipcRenderer.invoke('file:open'),
  exportBegin: (name, ext) => ipcRenderer.invoke('export:begin', name, ext),
  exportWrite: (id, position, data) => ipcRenderer.invoke('export:write', id, position, data),
  exportFinish: id => ipcRenderer.invoke('export:finish', id),
  exportAbort: id => ipcRenderer.invoke('export:abort', id),
  reveal: file => ipcRenderer.invoke('reveal', file),
  cacheInfo: key => ipcRenderer.invoke('cache:info', key),
  cacheWrite: (key, offset, data, last) => ipcRenderer.invoke('cache:write', key, offset, data, last),
  clipboardRead: () => ipcRenderer.invoke('clipboard:read'),
  clipboardWrite: text => ipcRenderer.invoke('clipboard:write', text),
  onMenu: cb => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
})
