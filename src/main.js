// Picture Book Writer — main process
// Handles windows, files on disk, PDF export and the application menu.
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const EXT = 'pbook';
let mainWindow = null;
let pendingOpenPath = null; // a file the user double-clicked before the window was ready
let allowClose = false;

// ---------- helpers ----------
const userDir = () => app.getPath('userData');
const settingsFile = () => path.join(userDir(), 'settings.json');
const recoveryFile = () => path.join(userDir(), 'recovery.json');
const backupsDir = () => path.join(userDir(), 'backups');

function desktopDir() {
  try { return app.getPath('desktop'); } catch { return app.getPath('home'); }
}

async function readJSON(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

// Write to a temp file then rename, so a crash never leaves a half-written book.
async function writeFileSafely(file, text) {
  const tmp = file + '.saving';
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, file);
}

async function getSettings() { return readJSON(settingsFile(), { recent: [] }); }
async function saveSettings(s) {
  await fsp.mkdir(userDir(), { recursive: true });
  await writeFileSafely(settingsFile(), JSON.stringify(s, null, 2));
}

async function addRecent(filePath) {
  const s = await getSettings();
  s.recent = [filePath, ...(s.recent || []).filter((p) => p !== filePath)].slice(0, 12);
  await saveSettings(s);
}

function safeName(name) {
  const cleaned = String(name || 'My Picture Book').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 80) || 'My Picture Book';
}

function uniquePath(dir, base, ext) {
  let p = path.join(dir, `${base}.${ext}`);
  let i = 2;
  while (fs.existsSync(p)) { p = path.join(dir, `${base} (${i}).${ext}`); i++; }
  return p;
}

function countWords(book) {
  let n = 0;
  for (const pg of book.pages || []) {
    if (['title', 'copyright', 'dedication'].includes(pg.role)) continue;
    const t = String(pg.text || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    n += (t.match(/[A-Za-z0-9À-ɏ']+/g) || []).length;
  }
  return n;
}

async function bookSummary(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    const book = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    const cover = (book.pages || []).find((p) => p.image);
    return {
      path: filePath,
      fileName: path.basename(filePath),
      folder: path.dirname(filePath),
      title: book.title || path.basename(filePath, '.' + EXT),
      author: book.author || '',
      words: countWords(book),
      pages: (book.pages || []).length,
      modified: stat.mtimeMs,
      thumb: cover ? cover.image : null,
    };
  } catch {
    return null;
  }
}

// ---------- window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    title: 'Picture Book Writer',
    backgroundColor: '#FBF6EC',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => { mainWindow.maximize(); mainWindow.show(); });

  // Links open in the normal web browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  // Let the page save any changes before the window closes.
  mainWindow.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    mainWindow.webContents.send('app:before-close');
  });

  // Right-click menu with spelling suggestions.
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.misspelledWord) {
      const sugg = params.dictionarySuggestions.slice(0, 6);
      if (sugg.length === 0) items.push({ label: 'No spelling suggestions', enabled: false });
      for (const s of sugg) items.push({ label: s, click: () => mainWindow.webContents.replaceMisspelling(s) });
      items.push({ label: 'Add to dictionary', click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ role: 'undo', label: 'Undo' }, { role: 'redo', label: 'Redo' }, { type: 'separator' });
      items.push({ role: 'cut', label: 'Cut' }, { role: 'copy', label: 'Copy' }, { role: 'paste', label: 'Paste' }, { role: 'selectAll', label: 'Select all' });
    } else if (params.selectionText) {
      items.push({ role: 'copy', label: 'Copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: mainWindow });
  });
}

function send(cmd) { if (mainWindow) mainWindow.webContents.send('menu:command', cmd); }

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Start a New Book…', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open a Book…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { label: 'My Books (Home)', accelerator: 'CmdOrCtrl+H', click: () => send('home') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save a Copy As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveAs') },
        { type: 'separator' },
        { label: 'Make a PDF…', accelerator: 'CmdOrCtrl+P', click: () => send('pdf') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Preview My Book', accelerator: 'F5', click: () => send('preview') },
        { label: 'Read My Book Aloud', click: () => send('read') },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Make Everything Bigger', accelerator: 'CmdOrCtrl+=' },
        { role: 'zoomOut', label: 'Make Everything Smaller' },
        { role: 'resetZoom', label: 'Normal Size' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Full Screen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Show Me Around (Tour)', click: () => send('tour') },
        { label: 'Help & Tips', accelerator: 'F1', click: () => send('help') },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools' }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- IPC: files ----------
ipcMain.handle('app:info', async () => ({
  desktop: desktopDir(),
  platform: process.platform,
  version: app.getVersion(),
  pendingOpenPath: (() => { const p = pendingOpenPath; pendingOpenPath = null; return p; })(),
}));

ipcMain.handle('books:list', async () => {
  const settings = await getSettings();
  const desk = desktopDir();
  let deskFiles = [];
  try {
    deskFiles = (await fsp.readdir(desk))
      .filter((f) => f.toLowerCase().endsWith('.' + EXT))
      .map((f) => path.join(desk, f));
  } catch { /* no desktop folder */ }
  const all = [...new Set([...deskFiles, ...(settings.recent || [])])];
  const summaries = (await Promise.all(all.map(bookSummary))).filter(Boolean);
  summaries.sort((a, b) => b.modified - a.modified);
  return summaries;
});

ipcMain.handle('books:newPath', async (_e, title, folder) => {
  const dir = folder || desktopDir();
  return uniquePath(dir, safeName(title), EXT);
});

ipcMain.handle('books:save', async (_e, filePath, book) => {
  const text = JSON.stringify(book);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  // Keep a few older versions, just in case.
  try {
    if (fs.existsSync(filePath)) {
      await fsp.mkdir(backupsDir(), { recursive: true });
      const base = safeName(path.basename(filePath, '.' + EXT));
      const stamp = new Date().toISOString().slice(0, 13).replace(/[:T]/g, '-'); // one per hour
      await fsp.copyFile(filePath, path.join(backupsDir(), `${base} ${stamp}.${EXT}`));
      const olds = (await fsp.readdir(backupsDir())).filter((f) => f.startsWith(base + ' ')).sort();
      for (const f of olds.slice(0, Math.max(0, olds.length - 10))) await fsp.unlink(path.join(backupsDir(), f));
    }
  } catch { /* backups are best-effort */ }
  await writeFileSafely(filePath, text);
  await addRecent(filePath);
  return { ok: true, path: filePath, folder: path.dirname(filePath), fileName: path.basename(filePath) };
});

ipcMain.handle('books:open', async (_e, filePath) => {
  const book = JSON.parse(await fsp.readFile(filePath, 'utf8'));
  await addRecent(filePath);
  return { book, path: filePath, fileName: path.basename(filePath), folder: path.dirname(filePath) };
});

ipcMain.handle('books:forget', async (_e, filePath) => {
  const s = await getSettings();
  s.recent = (s.recent || []).filter((p) => p !== filePath);
  await saveSettings(s);
});

ipcMain.handle('dialog:openBook', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a Picture Book',
    defaultPath: desktopDir(),
    properties: ['openFile'],
    filters: [{ name: 'Picture Books', extensions: [EXT] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:saveBookAs', async (_e, title) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Save a Copy of Your Book',
    defaultPath: path.join(desktopDir(), safeName(title) + '.' + EXT),
    filters: [{ name: 'Picture Books', extensions: [EXT] }],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('dialog:chooseFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose where to keep your book',
    defaultPath: desktopDir(),
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('shell:showFile', async (_e, filePath) => { shell.showItemInFolder(filePath); });
ipcMain.handle('shell:openFile', async (_e, filePath) => shell.openPath(filePath));

// ---------- IPC: recovery (for books never saved) ----------
ipcMain.handle('recovery:write', async (_e, data) => {
  await fsp.mkdir(userDir(), { recursive: true });
  await writeFileSafely(recoveryFile(), JSON.stringify(data));
});
ipcMain.handle('recovery:read', async () => readJSON(recoveryFile(), null));
ipcMain.handle('recovery:clear', async () => { try { await fsp.unlink(recoveryFile()); } catch { /* none */ } });

// ---------- IPC: PDF ----------
ipcMain.handle('pdf:make', async (_e, { html, fileBase, landscape, pageSize }) => {
  const tmp = path.join(app.getPath('temp'), `pbw-print-${Date.now()}.html`);
  await fsp.writeFile(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false, javascript: false } });
  try {
    await win.loadFile(tmp);
    await new Promise((r) => setTimeout(r, 400)); // let fonts and images settle
    const data = await win.webContents.printToPDF({
      landscape: !!landscape,
      pageSize: pageSize || 'Letter',
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
    });
    const out = uniquePath(desktopDir(), safeName(fileBase), 'pdf');
    await fsp.writeFile(out, data);
    return { ok: true, path: out, fileName: path.basename(out) };
  } finally {
    win.destroy();
    fsp.unlink(tmp).catch(() => {});
  }
});

// ---------- closing ----------
ipcMain.on('app:ready-to-close', () => { allowClose = true; if (mainWindow) mainWindow.close(); });

// ---------- app lifecycle ----------
function fileFromArgs(argv) {
  return argv.find((a) => typeof a === 'string' && a.toLowerCase().endsWith('.' + EXT) && fs.existsSync(a)) || null;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = fileFromArgs(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (f) mainWindow.webContents.send('app:open-path', f);
    }
  });

  // macOS: double-clicking a .pbook file
  app.on('open-file', (e, f) => {
    e.preventDefault();
    if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('app:open-path', f);
    else pendingOpenPath = f;
  });

  app.whenReady().then(() => {
    pendingOpenPath = pendingOpenPath || fileFromArgs(process.argv.slice(1));
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) { allowClose = false; createWindow(); } });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); else allowClose = false; });
}
