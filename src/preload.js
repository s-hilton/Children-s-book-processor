// Safely exposes a small set of file actions to the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bookAPI', {
  info: () => ipcRenderer.invoke('app:info'),
  listBooks: () => ipcRenderer.invoke('books:list'),
  newBookPath: (title, folder) => ipcRenderer.invoke('books:newPath', title, folder),
  saveBook: (filePath, book) => ipcRenderer.invoke('books:save', filePath, book),
  openBook: (filePath) => ipcRenderer.invoke('books:open', filePath),
  forgetBook: (filePath) => ipcRenderer.invoke('books:forget', filePath),
  chooseBookToOpen: () => ipcRenderer.invoke('dialog:openBook'),
  chooseSaveAs: (title) => ipcRenderer.invoke('dialog:saveBookAs', title),
  chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),
  showFile: (filePath) => ipcRenderer.invoke('shell:showFile', filePath),
  openFile: (filePath) => ipcRenderer.invoke('shell:openFile', filePath),
  writeRecovery: (data) => ipcRenderer.invoke('recovery:write', data),
  readRecovery: () => ipcRenderer.invoke('recovery:read'),
  clearRecovery: () => ipcRenderer.invoke('recovery:clear'),
  makePDF: (opts) => ipcRenderer.invoke('pdf:make', opts),
  readyToClose: () => ipcRenderer.send('app:ready-to-close'),
  onBeforeClose: (fn) => ipcRenderer.on('app:before-close', () => fn()),
  onMenu: (fn) => ipcRenderer.on('menu:command', (_e, cmd) => fn(cmd)),
  onOpenPath: (fn) => ipcRenderer.on('app:open-path', (_e, p) => fn(p)),
});
