// Web version of the file bridge (used when the app runs in a web browser, e.g. on GitHub Pages).
// In Chrome and Edge, books are real .pbook files on your computer (the Desktop is suggested),
// saved through the browser's File System Access feature. Other browsers keep books inside the
// browser and let you download a copy.
(function () {
  if (window.bookAPI) return; // running inside the desktop app

  const FS = typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function';
  const TYPES = [{ description: 'Picture Book', accept: { 'application/x-picture-book': ['.pbook'] } }];
  const uid = () => 'b_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ---------- tiny IndexedDB helper ----------
  let dbp = null;
  function db() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('picture-book-writer', 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('books', { keyPath: 'id' }); req.result.createObjectStore('kv'); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }
  const getRec = (id) => tx('books', 'readonly', (s) => s.get(id));
  const putRec = (rec) => tx('books', 'readwrite', (s) => s.put(rec));
  const delRec = (id) => tx('books', 'readwrite', (s) => s.delete(id));
  const allRecs = () => tx('books', 'readonly', (s) => s.getAll());
  const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
  const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
  const kvDel = (k) => tx('kv', 'readwrite', (s) => s.delete(k));

  // ---------- helpers ----------
  function safeName(name) {
    return String(name || 'My Picture Book').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'My Picture Book';
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
  function meta(book) {
    const cover = (book.pages || []).find((p) => p.image);
    return { title: book.title || 'Untitled', author: book.author || '', words: countWords(book), pages: (book.pages || []).length, modified: Date.now(), thumb: cover ? cover.image : null };
  }
  const where = (rec) => (rec.kind === 'file' ? 'web:file' : 'web:browser');
  const isAbort = (e) => e && (e.name === 'AbortError' || /abort|cancel/i.test(e.message || ''));

  async function ensurePermission(handle) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  function download(name, text, type = 'application/json') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function pickNewFile(title) {
    return window.showSaveFilePicker({ suggestedName: safeName(title) + '.pbook', startIn: 'desktop', types: TYPES, id: 'pbook' });
  }

  async function writeHandle(handle, book) {
    const w = await handle.createWritable();
    await w.write(JSON.stringify(book));
    await w.close();
  }

  // ---------- the API (same shape as the desktop app's) ----------
  const listeners = { open: null };

  window.bookAPI = {
    info: async () => ({ web: true, fs: FS, desktop: null, platform: 'web', version: '1.1.0', pendingOpenPath: await takeLaunchFile() }),

    listBooks: async () => {
      const recs = await allRecs();
      return recs.map((r) => ({ path: r.id, fileName: r.name, folder: where(r), ...r.meta })).sort((a, b) => b.modified - a.modified);
    },

    newBookPath: async (title) => 'new:' + safeName(title),

    saveBook: async (id, book, opts = {}) => {
      let rec;
      if (String(id).startsWith('new:')) {
        if (FS) {
          let handle;
          try { handle = await pickNewFile(book.title); } catch (e) { if (isAbort(e)) return { cancelled: true }; throw e; }
          rec = { id: uid(), kind: 'file', handle, name: handle.name };
        } else {
          rec = { id: uid(), kind: 'local', name: safeName(book.title) + '.pbook' };
        }
      } else {
        rec = await getRec(id);
        if (!rec) throw new Error('This book could not be found any more.');
      }
      if (rec.kind === 'file') {
        if (!(await ensurePermission(rec.handle))) throw new Error('Your browser did not allow saving to the file. Click Save and choose “Allow”.');
        await writeHandle(rec.handle, book);
      } else {
        rec.data = book;
        if (!opts.quiet) download(rec.name, JSON.stringify(book)); // also give a copy to keep
      }
      rec.meta = meta(book);
      await putRec(rec);
      return { ok: true, path: rec.id, folder: where(rec), fileName: rec.name };
    },

    openBook: async (id) => {
      const rec = await getRec(id);
      if (!rec) throw new Error('This book could not be found any more.');
      let book;
      if (rec.kind === 'file') {
        if (!(await ensurePermission(rec.handle))) throw new Error('Your browser needs permission to open this file. Please try again and choose “Allow”.');
        book = JSON.parse(await (await rec.handle.getFile()).text());
      } else {
        book = rec.data;
      }
      rec.meta = { ...meta(book), modified: (rec.meta && rec.meta.modified) || Date.now() };
      await putRec(rec);
      return { book, path: rec.id, fileName: rec.name, folder: where(rec) };
    },

    forgetBook: async (id) => delRec(id),

    chooseBookToOpen: async () => {
      if (FS) {
        try {
          const [handle] = await window.showOpenFilePicker({ startIn: 'desktop', types: TYPES, id: 'pbook', multiple: false });
          return await rememberHandle(handle);
        } catch (e) { if (isAbort(e)) return null; throw e; }
      }
      // Other browsers: read the file and keep it in the browser.
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pbook,application/json';
        input.onchange = async () => {
          const f = input.files[0];
          if (!f) return resolve(null);
          const book = JSON.parse(await f.text());
          const rec = { id: uid(), kind: 'local', name: f.name, data: book, meta: meta(book) };
          await putRec(rec);
          resolve(rec.id);
        };
        input.click();
      });
    },

    chooseSaveAs: async (title) => {
      if (!FS) return 'new:' + safeName(title);
      try {
        const handle = await pickNewFile(title);
        const rec = { id: uid(), kind: 'file', handle, name: handle.name, meta: { title, modified: Date.now() } };
        await putRec(rec);
        return rec.id;
      } catch (e) { if (isAbort(e)) return null; throw e; }
    },

    chooseFolder: async () => null,
    showFile: async () => {},
    openFile: async () => {},

    writeRecovery: async (data) => kvSet('recovery', data),
    readRecovery: async () => (await kvGet('recovery')) || null,
    clearRecovery: async () => kvDel('recovery'),

    // The browser's print window makes the PDF ("Save as PDF").
    makePDF: async ({ html }) => {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      document.body.appendChild(frame);
      await new Promise((resolve) => { frame.onload = resolve; frame.srcdoc = html; });
      await new Promise((r) => setTimeout(r, 400));
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => frame.remove(), 60000);
      return { ok: true, printed: true };
    },

    readyToClose: () => {},
    onBeforeClose: () => {},
    onMenu: () => {},
    onOpenPath: (fn) => { listeners.open = fn; },
  };

  async function rememberHandle(handle) {
    // Reuse the existing entry if we already know this file.
    for (const r of await allRecs()) {
      if (r.kind === 'file' && r.handle && (await r.handle.isSameEntry(handle).catch(() => false))) {
        r.handle = handle;
        await putRec(r);
        return r.id;
      }
    }
    const rec = { id: uid(), kind: 'file', handle, name: handle.name, meta: { title: handle.name.replace(/\.pbook$/i, ''), modified: Date.now() } };
    await putRec(rec);
    return rec.id;
  }

  // When installed as an app, double-clicking a .pbook file opens it here.
  let launchFile = null;
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files || !params.files.length) return;
      const id = await rememberHandle(params.files[0]);
      if (listeners.open) listeners.open(id); else launchFile = id;
    });
  }
  async function takeLaunchFile() {
    await new Promise((r) => setTimeout(r, 50));
    const f = launchFile;
    launchFile = null;
    return f;
  }
})();
