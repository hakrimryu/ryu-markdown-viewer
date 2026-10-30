const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('markdesk', {
  workspace: () => ipcRenderer.invoke('workspace'),
  addFolder: () => ipcRenderer.invoke('add-folder'),
  removeFolder: (path) => ipcRenderer.invoke('remove-folder', path),
  openFile: () => ipcRenderer.invoke('open-file'),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  saveFile: (path, content, revision) => ipcRenderer.invoke('save-file', path, content, revision),
  createFile: (directory) => ipcRenderer.invoke('create-file', directory),
  confirmUnsaved: (path) => ipcRenderer.invoke('confirm-unsaved', path),
  onBeforeClose: (callback) => { const handler = () => callback(); ipcRenderer.on('request-close', handler); return () => ipcRenderer.removeListener('request-close', handler); },
  resolveLink: (from, href) => ipcRenderer.invoke('resolve-link', from, href),
  saveSession: (session) => ipcRenderer.invoke('save-session', session),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  window: (action) => ipcRenderer.invoke('window', action),
  onChange: (callback) => { const handler = (_, value) => callback(value); ipcRenderer.on('workspace-changed', handler); return () => ipcRenderer.removeListener('workspace-changed', handler); },
  onOpen: (callback) => { const handler = (_, value) => callback(value); ipcRenderer.on('open-document', handler); return () => ipcRenderer.removeListener('open-document', handler); }
});
