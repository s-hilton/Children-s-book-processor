// Picture Book Writer — the page you see.
(function () {
  'use strict';
  const api = window.bookAPI;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = Exporter.esc;
  const uid = () => Math.random().toString(36).slice(2, 10);

  const ROLES = {
    story: 'Story page',
    title: 'Title page',
    copyright: 'Copyright page',
    dedication: 'Dedication',
    endmatter: 'Extra info (back of book)',
    blank: 'Picture only (no words)',
  };
  const ROLE_PLACEHOLDER = {
    story: 'Type the words for this page…',
    title: 'Your title page. Leave it empty and we’ll show your title and name here.',
    copyright: 'Copyright page — usually filled in by the publisher. You can leave this empty.',
    dedication: 'Who is this book for? e.g. “For Grandma, who read to me every night.”',
    endmatter: 'Extra info, like fun facts or a note to grown-ups…',
    blank: 'This page is just a picture. (You can still add words if you change your mind.)',
  };
  const AGES = {
    baby: { label: 'Babies & toddlers (0–3) — board book', goal: 150 },
    young: { label: 'Young children (3–5)', goal: 400 },
    picture: { label: 'Children (4–8) — classic picture book', goal: 500 },
    older: { label: 'Older children (6–9)', goal: 800 },
  };
  const TIPS = [
    'Leave room for the pictures! If the illustration can show it, you don’t need to say it.',
    'The best page turns make readers ask “What happens next?” Try ending right-hand pages with a little mystery.',
    'Read your story out loud. If you stumble on a sentence, a parent will too.',
    'Many picture books use the “rule of three” — the character tries three times before succeeding.',
    'Short, punchy words are fun to read aloud: splash, zoom, crunch, pop!',
    'Most picture books are 32 pages, and many publishers like stories under about 600 words.',
    'Give your main character a problem they solve themselves — kids love a clever hero.',
    'A repeating line (a “refrain”) helps children join in when the book is read aloud.',
  ];

  // Only these kinds of pages count toward the story's word count.
  const COUNTED = new Set(['story', 'blank', 'endmatter']);

  const S = {
    info: null,
    book: null,
    filePath: null,
    dirty: false,
    saving: false,
    lastSaved: null,
    spread: 0,
    activePage: null,
    lastRange: null,
    readQueue: null,
    previewSpread: 0,
  };

  // ============================================================
  //  Small UI helpers: toast, tooltips, modals
  // ============================================================
  let toastTimer = null;
  function toast(msg, ms = 3200) {
    const t = $('#toast');
    t.innerHTML = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  // Friendly tooltips on anything with data-tip
  (function tooltips() {
    const tip = $('#tooltip');
    let timer = null;
    let current = null;
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest('[data-tip]');
      if (el === current) return;
      current = el;
      clearTimeout(timer);
      tip.hidden = true;
      if (!el) return;
      timer = setTimeout(() => {
        tip.textContent = el.dataset.tip;
        tip.hidden = false;
        const r = el.getBoundingClientRect();
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        let x = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
        let y = r.bottom + 10;
        if (y + th > window.innerHeight - 8) y = r.top - th - 10;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
      }, 450);
    });
    document.addEventListener('mousedown', () => { clearTimeout(timer); tip.hidden = true; });
  })();

  // Generic modal. Returns a promise with the value of the button clicked.
  function modal({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], wide = false, onOpen, dismissValue = null }) {
    return new Promise((resolve) => {
      const root = $('#modal-root');
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        <button class="modal-x" aria-label="Close">✕</button>
        ${title ? `<h2>${title}</h2>` : ''}
        <div class="modal-body"></div>
        <div class="modal-buttons"></div></div>`;
      const bodyEl = $('.modal-body', wrap);
      if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
      const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      const btnRow = $('.modal-buttons', wrap);
      for (const b of buttons) {
        const el = document.createElement('button');
        el.className = 'btn ' + (b.primary ? 'primary big' : b.danger ? 'danger big' : 'big');
        el.innerHTML = b.label;
        el.addEventListener('click', async () => {
          if (b.validate) { const ok = await b.validate(wrap); if (!ok) return; }
          close(typeof b.value === 'function' ? b.value(wrap) : b.value);
        });
        btnRow.appendChild(el);
      }
      $('.modal-x', wrap).addEventListener('click', () => close(dismissValue));
      wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(dismissValue); });
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close(dismissValue); }
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { const p = buttons.findIndex((b) => b.primary); if (p >= 0) btnRow.children[p].click(); }
      };
      document.addEventListener('keydown', onKey, true);
      root.appendChild(wrap);
      if (onOpen) onOpen(wrap, close);
      const first = $('input, textarea', bodyEl);
      setTimeout(() => (first || btnRow.querySelector('.primary') || btnRow.firstChild)?.focus(), 30);
    });
  }

  function timeAgo(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} minute${s < 120 ? '' : 's'} ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} hour${s < 7200 ? '' : 's'} ago`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)} day${s < 172800 ? '' : 's'} ago`;
    return new Date(ms).toLocaleDateString();
  }

  // Web version helpers
  const isWeb = () => !!(S.info && S.info.web);
  const saveSpot = () => (isWeb() ? (S.info.fs ? 'on your computer, in the place you choose (the <b>Desktop</b> is suggested)' : 'in this web browser') : 'on your <b>Desktop</b>');

  function whereLabel(folder) {
    if (folder === 'web:file') return 'on your computer';
    if (folder === 'web:browser') return 'in this web browser';
    if (!folder || !S.info) return '';
    if (folder === S.info.desktop) return 'on your Desktop';
    return 'in ' + folder;
  }

  // ============================================================
  //  Book model
  // ============================================================
  function defaultRole(i, n) {
    if (n <= 16) return i === 0 ? 'title' : 'story';
    if (i === 0) return 'title';
    if (i === 1) return 'copyright';
    if (i === 2) return 'dedication';
    return 'story';
  }
  function makePage(role) { return { id: uid(), role, text: '', art: '', image: null, textPos: 'bottom', joinWithNext: false }; }

  function newBook({ title, author, pageCount, age }) {
    return {
      format: 'picture-book-writer',
      version: 1,
      title: title || 'My Picture Book',
      author: author || '',
      contact: localStorageGet('pbw.contact') || '',
      age: age || 'picture',
      wordGoal: AGES[age || 'picture'].goal,
      pitch: '',
      notes: '',
      characters: [],
      pages: Array.from({ length: pageCount }, (_, i) => makePage(defaultRole(i, pageCount))),
      created: Date.now(),
      modified: Date.now(),
    };
  }

  function normalizeBook(b) {
    if (!b || !Array.isArray(b.pages)) throw new Error('This doesn’t look like a picture book file.');
    b.format = 'picture-book-writer';
    b.version = 1;
    b.title = b.title || 'My Picture Book';
    b.author = b.author || '';
    b.contact = b.contact || '';
    b.age = AGES[b.age] ? b.age : 'picture';
    b.wordGoal = +b.wordGoal || AGES[b.age].goal;
    b.pitch = b.pitch || '';
    b.notes = b.notes || '';
    b.characters = Array.isArray(b.characters) ? b.characters : [];
    b.pages = b.pages.map((p) => ({ ...makePage('story'), ...p, id: p.id || uid(), role: ROLES[p.role] ? p.role : 'story' }));
    return b;
  }

  function spreadsFor(n) {
    const s = [[null, 1]];
    for (let p = 2; p < n; p += 2) s.push([p, p + 1]);
    if (n % 2 === 0) s.push([n, null]);
    return s;
  }
  const spreads = () => spreadsFor(S.book.pages.length);
  function spreadOfPage(pageNum) { return spreads().findIndex(([a, b]) => a === pageNum || b === pageNum); }

  function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

  // Keep only simple formatting (bold / italic / underline / line breaks).
  function sanitize(html) {
    const src = document.createElement('div');
    src.innerHTML = html;
    const out = document.createElement('div');
    const allowed = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', BR: 'br', DIV: 'div', P: 'div' };
    (function walk(from, to) {
      for (const n of from.childNodes) {
        if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        const tag = allowed[n.tagName];
        if (tag) { const el = document.createElement(tag); to.appendChild(el); walk(n, el); }
        else walk(n, to);
      }
    })(src, out);
    return out.innerHTML;
  }

  // ============================================================
  //  Saving and opening
  // ============================================================
  let autosaveTimer = null;
  function markDirty() {
    S.dirty = true;
    S.rev = (S.rev || 0) + 1;
    S.book.modified = Date.now();
    setSaveStatus();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => autoSave(), 1500);
  }

  async function autoSave() {
    if (!S.dirty || !S.book) return;
    if (S.saving) { autosaveTimer = setTimeout(autoSave, 800); return; }
    if (S.filePath) await saveNow({ quiet: true });
    else { try { await api.writeRecovery({ book: S.book, at: Date.now() }); } catch { /* ignore */ } setSaveStatus(); }
  }

  function setSaveStatus(state) {
    const el = $('#save-status');
    if (!el || !S.book) return;
    const where = S.where ? whereLabel(S.where) : (S.filePath ? whereLabel(S.filePath.replace(/[\\/][^\\/]*$/, '')) : '');
    if (state === 'saving' || S.saving) { el.className = 'save-status saving'; el.innerHTML = '⏳ Saving…'; return; }
    if (state === 'error') { el.className = 'save-status error'; el.innerHTML = '⚠️ Couldn’t save — click Save to try again'; return; }
    if (!S.filePath || String(S.filePath).startsWith('new:')) { el.className = 'save-status warn'; el.innerHTML = '⚠️ Not saved yet — click <b>Save</b>'; return; }
    if (S.dirty) { el.className = 'save-status'; el.innerHTML = '✏️ Changes will save in a moment…'; return; }
    el.className = 'save-status ok';
    el.innerHTML = isWeb() ? `✓ All changes saved ${esc(where)}` : `✓ All changes saved ${esc(where)} <span class="link-like">· show me</span>`;
    el.dataset.tip = isWeb() ? 'Your book saves itself while you work.' : 'Your book saves itself while you work. Click to see the file.';
  }

  async function saveNow({ quiet = false } = {}) {
    if (!S.book) return false;
    if (!S.filePath) return saveFirstTime();
    clearTimeout(autosaveTimer);
    S.saving = true;
    setSaveStatus('saving');
    try {
      const rev = S.rev;
      const r = await api.saveBook(S.filePath, S.book, { quiet });
      S.saving = false;
      if (r && r.cancelled) { setSaveStatus(); if (!quiet) toast('Not saved yet. Click <b>Save</b> when you’re ready.'); return false; }
      if (r.path) S.filePath = r.path;
      if (r.folder) S.where = r.folder;
      if (S.rev === rev) S.dirty = false;
      S.lastSaved = Date.now();
      setSaveStatus();
      if (!quiet) toast(`💾 Saved! <b>${esc(r.fileName)}</b> is ${esc(whereLabel(r.folder))}.`);
      return true;
    } catch (err) {
      S.saving = false;
      setSaveStatus('error');
      if (!quiet) await modal({ title: 'Hmm, the book couldn’t be saved', body: `<p>${esc(err.message || err)}</p><p>Try <b>File → Save a Copy As…</b> to save it somewhere else.</p>` });
      return false;
    }
  }

  // Used when a book has never been saved (e.g. recovered work).
  async function saveFirstTime() {
    let folder = null;
    const res = await modal({
      title: '💾 Save your book',
      body: `<label class="lbl">What should we call the file?</label>
        <input class="input big" id="sv-name" value="${esc(S.book.title)}">
        <p class="where-line">It will be saved ${saveSpot()}. ${isWeb() ? '' : '<button class="btn link" id="sv-folder">Choose a different place</button>'}</p>`,
      onOpen: (w) => {
        if ($('#sv-folder', w)) $('#sv-folder', w).addEventListener('click', async () => {
          const f = await api.chooseFolder();
          if (f) { folder = f; $('.where-line', w).innerHTML = `It will be saved in <b>${esc(f)}</b>.`; }
        });
      },
      buttons: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, value: (w) => $('#sv-name', w).value.trim() || S.book.title }],
    });
    if (!res) return false;
    S.filePath = await api.newBookPath(res, folder);
    const ok = await saveNow();
    if (ok) api.clearRecovery();
    return ok;
  }

  async function saveCopyAs() {
    if (!S.book) return;
    const p = await api.chooseSaveAs(S.book.title);
    if (!p) return;
    S.filePath = p;
    await saveNow();
  }

  async function openPath(filePath) {
    if (S.book && S.dirty) await saveNow({ quiet: true });
    try {
      const r = await api.openBook(filePath);
      loadBook(normalizeBook(r.book), r.path, r.folder);
      toast(`📖 Opened <b>${esc(S.book.title)}</b>`);
    } catch (err) {
      await modal({ title: 'That book couldn’t be opened', body: `<p>It may have been moved, renamed or deleted.</p><p class="muted small">${esc(err.message || err)}</p>` });
      api.forgetBook(filePath);
      if (!S.book) showHome();
    }
  }

  async function openFromDialog() {
    const p = await api.chooseBookToOpen();
    if (p) openPath(p);
  }

  // ============================================================
  //  HOME screen
  // ============================================================
  async function showHome() {
    if (S.book && S.dirty) await saveNow({ quiet: true });
    stopReading();
    S.book = null;
    S.filePath = null;
    S.dirty = false;
    document.title = 'Picture Book Writer';
    $('#editor').hidden = true;
    $('#preview').hidden = true;
    $('#home').hidden = false;
    const h = new Date().getHours();
    $('#greeting').textContent = (h < 12 ? 'Good morning!' : h < 18 ? 'Good afternoon!' : 'Good evening!') + ' What would you like to do today?';
    $('#books-where').textContent = isWeb() ? '— books you’ve opened or created here' : '— books on your Desktop and ones you opened recently';
    renderWebNote();
    await renderRecovery();
    const grid = $('#book-grid');
    grid.innerHTML = '<p class="muted">Looking for your books…</p>';
    let books = [];
    try { books = await api.listBooks(); } catch { /* ignore */ }
    if (!books.length) {
      grid.innerHTML = `<div class="empty-books"><div class="eb-icon">📚</div><p><b>No books yet.</b></p><p class="muted">Click <b>Start a new book</b> above — your book will be saved ${saveSpot()}, and it saves itself as you write.</p></div>`;
      return;
    }
    grid.innerHTML = '';
    const colors = ['#F28C6B', '#4FA3A5', '#8E7DBE', '#E9B44C', '#5B8E7D', '#D96C8A'];
    books.forEach((b, i) => {
      const card = document.createElement('div');
      card.className = 'book-card';
      card.tabIndex = 0;
      card.dataset.tip = 'Click to open this book';
      const color = colors[(b.title.length + i) % colors.length];
      card.innerHTML = `
        <div class="bc-cover" style="--c:${color}">${b.thumb ? `<img src="${b.thumb}" alt="">` : ''}<span class="bc-cover-title">${esc(b.title)}</span></div>
        <div class="bc-info">
          <div class="bc-title">${esc(b.title)}</div>
          <div class="bc-meta">${b.author ? 'by ' + esc(b.author) + ' · ' : ''}${b.words} words · ${b.pages} pages</div>
          <div class="bc-meta">Last changed ${timeAgo(b.modified)}</div>
          <div class="bc-where">📍 ${esc(whereLabel(b.folder))}</div>
        </div>
        <div class="bc-actions"><button class="btn primary">Open</button>${isWeb() ? '<button class="btn subtle bc-forget" data-tip="Take this book off the list (the file itself is not deleted)">Remove from list</button>' : '<button class="btn subtle bc-show" data-tip="Show this file in its folder">Show file</button>'}</div>`;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.bc-show')) { api.showFile(b.path); return; }
        if (e.target.closest('.bc-forget')) { api.forgetBook(b.path).then(showHome); return; }
        openPath(b.path);
      });
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openPath(b.path); });
      grid.appendChild(card);
    });
  }

  function renderWebNote() {
    let el = $('#web-note');
    if (!isWeb()) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'web-note'; el.className = 'banner info'; $('.big-actions').before(el); }
    el.innerHTML = S.info.fs
      ? '<span>💡 You’re using the web version. Your books are saved as files on your computer — when you save a new book, choose your <b>Desktop</b>. Your browser may ask permission to edit the file: choose <b>Allow</b>.</span>'
      : '<span>💡 This browser can’t save straight to your Desktop, so books are kept inside the browser. Click <b>Save</b> to download a copy. For saving to your Desktop, open this page in <b>Google Chrome</b> or <b>Microsoft Edge</b>.</span>';
  }

  async function renderRecovery() {
    const el = $('#recovery-banner');
    let rec = null;
    try { rec = await api.readRecovery(); } catch { /* ignore */ }
    if (!rec || !rec.book) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<span>🛟 We found a book you were working on that was never saved: <b>${esc(rec.book.title)}</b> (${timeAgo(rec.at)}).</span>
      <span><button class="btn primary" id="rec-continue">Continue it</button> <button class="btn subtle" id="rec-discard">Throw it away</button></span>`;
    $('#rec-continue').onclick = () => { loadBook(normalizeBook(rec.book), null); S.dirty = true; setSaveStatus(); };
    $('#rec-discard').onclick = async () => {
      const ok = await modal({ title: 'Throw this book away?', body: '<p>This can’t be undone.</p>', buttons: [{ label: 'Keep it', value: false }, { label: 'Throw it away', danger: true, value: true }] });
      if (ok) { await api.clearRecovery(); el.hidden = true; }
    };
  }

  // New-book wizard
  async function newBookWizard() {
    let folder = null;
    let size = 32;
    const sizes = [
      { n: 32, title: '32 pages', sub: 'The most common picture book size', rec: true },
      { n: 24, title: '24 pages', sub: 'A shorter picture book' },
      { n: 40, title: '40 pages', sub: 'A longer picture book' },
      { n: 12, title: '12 pages', sub: 'A board book for babies & toddlers' },
    ];
    const res = await modal({
      title: '✨ Start a new book',
      wide: true,
      body: `
        <label class="lbl" for="nb-title">What is your book called? <span class="muted small">(you can change this later)</span></label>
        <input class="input big" id="nb-title" placeholder="e.g. The Bear Who Couldn’t Sleep">
        <label class="lbl" for="nb-author">Your name (the author)</label>
        <input class="input big" id="nb-author" value="${esc(localStorageGet('pbw.author') || '')}" placeholder="e.g. Sam Rivers">
        <div class="lbl">How many pages?</div>
        <div class="size-grid">${sizes.map((s) => `
          <button class="size-card ${s.n === 32 ? 'selected' : ''}" data-n="${s.n}">
            <span class="sc-book">${'▯'.repeat(Math.min(6, s.n / 6 | 0))}</span>
            <span class="sc-title">${s.title}${s.rec ? ' <span class="pill">Recommended</span>' : ''}</span>
            <span class="sc-sub">${s.sub}</span></button>`).join('')}
        </div>
        <p class="where-line">📍 ${isWeb() && S.info.fs ? 'When you click <b>Create my book</b>, a save window opens. Choose your <b>Desktop</b> (it’s suggested) and click <b>Save</b>. After that, your book saves itself as you write.' : `Your book will be saved ${saveSpot()}, and it saves itself as you write.`} ${isWeb() ? '' : '<button class="btn link" id="nb-folder">Save it somewhere else</button>'}</p>`,
      onOpen: (w) => {
        $$('.size-card', w).forEach((c) => c.addEventListener('click', () => {
          $$('.size-card', w).forEach((x) => x.classList.remove('selected'));
          c.classList.add('selected');
          size = +c.dataset.n;
        }));
        if ($('#nb-folder', w)) $('#nb-folder', w).addEventListener('click', async () => {
          const f = await api.chooseFolder();
          if (f) { folder = f; $('.where-line', w).innerHTML = `📍 Your book will be saved in <b>${esc(f)}</b>.`; }
        });
      },
      buttons: [
        { label: 'Cancel', value: null },
        {
          label: 'Create my book →', primary: true,
          validate: (w) => { const t = $('#nb-title', w); if (!t.value.trim()) { t.classList.add('shake'); t.placeholder = 'Please give your book a name (you can change it later)'; setTimeout(() => t.classList.remove('shake'), 500); t.focus(); return false; } return true; },
          value: (w) => ({ title: $('#nb-title', w).value.trim(), author: $('#nb-author', w).value.trim() }),
        },
      ],
    });
    if (!res) return;
    if (res.author) localStorageSet('pbw.author', res.author);
    if (S.book && S.dirty) await saveNow({ quiet: true });
    const book = newBook({ title: res.title, author: res.author, pageCount: size, age: size <= 16 ? 'baby' : 'picture' });
    const filePath = await api.newBookPath(res.title, folder);
    loadBook(book, filePath);
    const saved = await saveNow({ quiet: true });
    if (saved) toast(`🎉 Your new book is saved ${esc(S.where ? whereLabel(S.where) : whereLabel(folder || S.info.desktop))}. Start writing!`, 4500);
    else toast('Your book isn’t saved yet — click <b>Save</b> at the top when you’re ready.', 5000);
    if (!localStorageGet('pbw.toured')) setTimeout(() => startTour(), 700);
  }

  // ============================================================
  //  EDITOR
  // ============================================================
  function loadBook(book, filePath, where) {
    S.book = book;
    S.filePath = filePath;
    S.where = where || null;
    S.dirty = false;
    const firstStory = book.pages.findIndex((p) => p.role === 'story');
    S.spread = firstStory >= 0 ? spreadOfPage(firstStory + 1) : 0;
    S.activePage = null;
    $('#home').hidden = true;
    $('#editor').hidden = false;
    $('#book-title').value = book.title;
    document.title = `${book.title} — Picture Book Writer`;
    renderSpread();
    renderMap();
    renderDetails();
    updateStats();
    setSaveStatus();
  }

  function pageCardHTML(pageNum, side, joined) {
    const p = S.book.pages[pageNum - 1];
    const roleOpts = Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${v}</option>`).join('');
    const pic = joined ? '' : `
      <div class="pc-pic ${p.image ? 'has-img' : ''}" data-tip="${p.image ? 'Your picture or sketch' : 'Add a sketch or picture from your computer (optional)'}">
        ${p.image ? `<img src="${p.image}" alt=""><button class="pc-pic-remove" data-act="remove-img" data-tip="Take this picture off the page">✕ Remove</button>`
        : `<button class="pc-pic-add" data-act="add-img"><span class="big-emoji">🖼️</span><span>Add a picture or sketch</span><span class="muted small">optional</span></button>`}
      </div>
      <textarea class="pc-art" rows="2" spellcheck="true" placeholder="🎨 Picture idea — what does the illustration show? (a note for the illustrator)">${esc(p.art)}</textarea>`;
    return `
      <div class="page-card ${side} pos-${p.textPos} role-${p.role}" data-page="${pageNum}">
        <div class="pc-head">
          <span class="pc-num">Page ${pageNum}</span>
          <select class="pc-role" data-tip="What kind of page is this?">${roleOpts}</select>
          <span class="pc-words"></span>
          <button class="pc-move" data-act="move" data-tip="Move this page somewhere else in the book">🔀 Move</button>
        </div>
        <div class="pc-body">
          ${pic}
          <div class="pc-text" contenteditable="true" spellcheck="true" data-placeholder="${esc(ROLE_PLACEHOLDER[p.role])}">${p.text}</div>
        </div>
        <div class="pc-foot">
          <button class="btn subtle small" data-act="textpos" data-tip="Choose whether the words sit above or below the picture">${p.textPos === 'top' ? '⬆ Words above picture' : '⬇ Words below picture'}</button>
        </div>
      </div>`;
  }

  function emptySideHTML(side) {
    return `<div class="page-card ${side} endpaper"><div class="endpaper-inner"><div class="big-emoji">📕</div>
      <p><b>Inside of the cover</b></p><p class="muted small">In a real book, this side is glued to the cover. ${side === 'left' ? 'Your story starts on the right!' : 'The book ends on the left page.'}</p></div></div>`;
  }

  function renderSpread() {
    const sp = spreads();
    S.spread = Math.max(0, Math.min(S.spread, sp.length - 1));
    const [a, b] = sp[S.spread];
    const L = a ? S.book.pages[a - 1] : null;
    const joined = !!(L && b && L.joinWithNext);
    const el = $('#spread');
    el.classList.toggle('joined', joined);
    let html = '';
    if (joined) {
      html += `<div class="joined-pic">
        <div class="pc-pic wide ${L.image ? 'has-img' : ''}" data-page="${a}">
          ${L.image ? `<img src="${L.image}" alt=""><button class="pc-pic-remove" data-act="remove-img" data-page="${a}">✕ Remove</button>`
          : `<button class="pc-pic-add" data-act="add-img" data-page="${a}"><span class="big-emoji">🖼️</span><span>Add one big picture across both pages</span><span class="muted small">optional</span></button>`}
        </div>
        <textarea class="pc-art wide" data-page="${a}" rows="2" spellcheck="true" placeholder="🎨 Picture idea for this whole spread…">${esc(L.art)}</textarea>
      </div>`;
    }
    html += `<div class="pages">${a ? pageCardHTML(a, 'left', joined) : emptySideHTML('left')}<div class="spine"></div>${b ? pageCardHTML(b, 'right', joined) : emptySideHTML('right')}</div>`;
    el.innerHTML = html;

    $('#spread-label').innerHTML = a && b ? `Pages ${a} – ${b} <span class="muted">of ${S.book.pages.length}</span>` : `Page ${a || b} <span class="muted">of ${S.book.pages.length}</span>`;
    $('#nav-prev').disabled = S.spread === 0;
    $('#nav-next').disabled = S.spread === sp.length - 1;
    const jt = $('#join-spread');
    jt.checked = joined;
    jt.disabled = !(a && b);
    jt.parentElement.classList.toggle('disabled', !(a && b));
    updatePageWordBadges();
    renderPageTurnHint();
    $$('.map-item').forEach((m) => m.classList.toggle('current', +m.dataset.spread === S.spread));
    const cur = $(`.map-item[data-spread="${S.spread}"]`);
    if (cur) cur.scrollIntoView({ block: 'nearest' });
    renderBeats();
  }

  function goSpread(i, focusPage) {
    S.spread = i;
    renderSpread();
    $('#stage').scrollTop = 0;
    if (focusPage) {
      const ed = $(`.page-card[data-page="${focusPage}"] .pc-text`);
      if (ed) { ed.focus(); placeCaretAtEnd(ed); ed.closest('.page-card').classList.add('flash'); setTimeout(() => ed.closest('.page-card')?.classList.remove('flash'), 1200); }
    }
  }
  function goPage(n) { goSpread(spreadOfPage(n), n); }

  function placeCaretAtEnd(el) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  function pageWords(p) { return Words.words(Words.textOf(p.text)).length; }

  function updatePageWordBadges() {
    $$('.page-card[data-page]').forEach((card) => {
      const p = S.book.pages[+card.dataset.page - 1];
      const n = pageWords(p);
      const badge = $('.pc-words', card);
      badge.textContent = n === 1 ? '1 word' : `${n} words`;
      badge.className = 'pc-words' + (n > 60 ? ' busy' : '');
      badge.dataset.tip = n > 60 ? 'This page has lots of words. Picture book pages usually have fewer than 50.' : 'Words on this page';
    });
  }

  function lastWordsOf(p, count = 6) {
    const w = Words.words(Words.textOf(p.text));
    return w.slice(-count).join(' ');
  }

  function renderPageTurnHint() {
    const el = $('#page-turn-hint');
    const [, b] = spreads()[S.spread];
    const R = b ? S.book.pages[b - 1] : null;
    if (!R || R.role !== 'story' || b === S.book.pages.length) { el.innerHTML = ''; return; }
    const lw = lastWordsOf(R);
    el.innerHTML = `<span class="ptn-icon">↪️</span> <span><b>Page turn!</b> After page ${b} the reader turns the page. ${lw ? `This spread ends with “…${esc(lw)}”. Does it make them want to see what happens next?` : 'End this page with a little surprise or question to keep readers turning.'}</span>`;
  }

  // ---- editing events (delegated) ----
  function pageFromEl(el) {
    const host = el.closest('[data-page]');
    return host ? +host.dataset.page : null;
  }

  function wireEditor() {
    const spreadEl = $('#spread');
    spreadEl.addEventListener('input', (e) => {
      const n = pageFromEl(e.target);
      if (!n) return;
      const p = S.book.pages[n - 1];
      if (e.target.classList.contains('pc-text')) {
        p.text = sanitize(e.target.innerHTML);
        if (!e.target.textContent.trim() && !e.target.querySelector('img')) { e.target.innerHTML = ''; p.text = ''; }
        updatePageWordBadges();
        renderBeats();
      } else if (e.target.classList.contains('pc-art')) {
        p.art = e.target.value;
      }
      markDirty();
      scheduleStats();
    });
    spreadEl.addEventListener('paste', (e) => {
      if (!e.target.closest('.pc-text')) return;
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    spreadEl.addEventListener('focusin', (e) => {
      const n = pageFromEl(e.target);
      if (n && e.target.classList.contains('pc-text')) { S.activePage = n; renderBeats(); }
    });
    spreadEl.addEventListener('change', (e) => {
      if (!e.target.classList.contains('pc-role')) return;
      const n = pageFromEl(e.target);
      S.book.pages[n - 1].role = e.target.value;
      markDirty();
      renderSpread();
      renderMap();
      scheduleStats();
    });
    spreadEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const n = +(btn.dataset.page || pageFromEl(btn));
      const p = S.book.pages[n - 1];
      if (btn.dataset.act === 'add-img') pickImage(n);
      if (btn.dataset.act === 'remove-img') { p.image = null; markDirty(); renderSpread(); renderMap(); }
      if (btn.dataset.act === 'move') openSorter(n);
      if (btn.dataset.act === 'textpos') { p.textPos = p.textPos === 'top' ? 'bottom' : 'top'; markDirty(); renderSpread(); }
    });
    document.addEventListener('selectionchange', () => {
      const sel = getSelection();
      if (!sel.rangeCount) return;
      const node = sel.anchorNode;
      const ed = node && (node.nodeType === 1 ? node : node.parentElement)?.closest?.('.pc-text');
      if (ed) { S.lastRange = sel.getRangeAt(0).cloneRange(); S.activePage = pageFromEl(ed); }
    });

    $$('.fmt').forEach((b) => {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        if (!document.activeElement?.classList.contains('pc-text')) { toast('Click on some words first, then choose a style.'); return; }
        document.execCommand(b.dataset.cmd);
      });
    });
    $('#join-spread').addEventListener('change', (e) => {
      const [a] = spreads()[S.spread];
      if (!a) return;
      const L = S.book.pages[a - 1];
      const R = S.book.pages[a];
      L.joinWithNext = e.target.checked;
      if (e.target.checked && !L.image && R && R.image) L.image = R.image;
      if (e.target.checked && R && R.art && !L.art) L.art = R.art;
      markDirty();
      renderSpread();
      renderMap();
    });
    $('#nav-prev').addEventListener('click', () => goSpread(S.spread - 1));
    $('#nav-next').addEventListener('click', () => goSpread(S.spread + 1));
    $('#book-title').addEventListener('input', (e) => {
      S.book.title = e.target.value;
      document.title = `${S.book.title || 'Untitled'} — Picture Book Writer`;
      const d = $('#d-title'); if (d) d.value = S.book.title;
      markDirty();
    });
    $('#save-status').addEventListener('click', () => {
      if (S.filePath && !S.dirty && !String(S.filePath).startsWith('new:')) { if (!isWeb()) api.showFile(S.filePath); }
      else saveNow();
    });
  }

  function pickImage(pageNum) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 1400;
          const k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * k);
          c.height = Math.round(img.height * k);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          S.book.pages[pageNum - 1].image = c.toDataURL('image/jpeg', 0.85);
          markDirty();
          renderSpread();
          renderMap();
          toast('🖼️ Picture added!');
        };
        img.onerror = () => toast('Sorry, that picture couldn’t be opened. Try a JPG or PNG file.');
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }

  // ============================================================
  //  BOOK MAP
  // ============================================================
  let mapTimer = null;
  function scheduleMap() { clearTimeout(mapTimer); mapTimer = setTimeout(renderMap, 500); }

  function miniPage(n) {
    if (!n) return '<div class="mini-page cover"></div>';
    const p = S.book.pages[n - 1];
    const words = pageWords(p);
    const snippet = Words.textOf(p.text).trim().slice(0, 60);
    const label = p.role === 'story' ? '' : `<span class="mini-role">${ROLES[p.role].split(' ')[0]}</span>`;
    return `<div class="mini-page ${words > 60 ? 'busy' : ''} ${words ? '' : 'emptyp'}">
      ${p.image ? `<img src="${p.image}" alt="">` : ''}
      ${label}<span class="mini-snip">${esc(snippet)}</span>
      <span class="mini-num">${n}</span></div>`;
  }

  function renderMap() {
    if (!S.book) return;
    const list = $('#map-list');
    list.innerHTML = spreads().map(([a, b], i) => {
      const words = (a ? pageWords(S.book.pages[a - 1]) : 0) + (b ? pageWords(S.book.pages[b - 1]) : 0);
      const joined = a && b && S.book.pages[a - 1].joinWithNext;
      return `<button class="map-item ${i === S.spread ? 'current' : ''}" data-spread="${i}">
        <div class="mini-spread ${joined ? 'joined' : ''}">${miniPage(a)}${miniPage(b)}</div>
        <div class="map-cap">${a && b ? `Pages ${a}–${b}` : `Page ${a || b}`} <span class="muted">· ${words} words</span></div>
      </button>`;
    }).join('');
  }

  // ============================================================
  //  STORY CHECK (statistics)
  // ============================================================
  let statsTimer = null;
  function scheduleStats() { clearTimeout(statsTimer); statsTimer = setTimeout(() => { updateStats(); scheduleMap(); }, 350); }

  function computeStats() {
    const b = S.book;
    const perPage = b.pages.map((p, i) => ({ n: i + 1, role: p.role, text: Words.textOf(p.text) }));
    const all = perPage.filter((p) => COUNTED.has(p.role)).map((p) => p.text).join('\n');
    const words = Words.words(all);
    const total = words.length;
    const storyPages = perPage.filter((p) => p.role === 'story');
    const emptyStory = storyPages.filter((p) => !p.text.trim()).map((p) => p.n);
    const busy = perPage.map((p) => ({ n: p.n, w: Words.words(p.text).length })).filter((x) => x.w > 60);
    const longSentences = [];
    const bigWords = new Map();
    const counts = new Map();
    for (const p of perPage) {
      for (const s of Words.sentences(p.text)) {
        const wc = Words.words(s).length;
        if (wc >= 20) longSentences.push({ n: p.n, s, wc });
      }
      for (const w of Words.words(p.text)) {
        const lw = w.toLowerCase().replace(/’/g, "'");
        if (Words.syllables(lw) >= 3 && !bigWords.has(lw)) bigWords.set(lw, p.n);
        if (!Words.STOP.has(lw) && lw.length > 2 && !/^\d+$/.test(lw)) counts.set(lw, (counts.get(lw) || 0) + 1);
      }
    }
    const repeated = [...counts.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const grade = Words.gradeLevel(all);
    return { total, grade, storyPages, emptyStory, busy, longSentences, bigWords, repeated, minutes: total / 110 };
  }

  function updateStats() {
    if (!S.book) return;
    const st = computeStats();
    const goal = S.book.wordGoal || 500;
    const pct = Math.min(100, (st.total / Math.max(goal * 1.6, 1)) * 100);
    const goalPct = (goal / (goal * 1.6)) * 100;
    let verdict;
    if (st.total === 0) verdict = { cls: '', text: 'Start typing on any page — I’ll keep count for you.' };
    else if (st.total < goal * 0.4) verdict = { cls: 'ok', text: 'A great start! Keep going.' };
    else if (st.total <= goal * 1.1) verdict = { cls: 'good', text: 'Lovely — a great length for this kind of book.' };
    else if (st.total <= goal * 1.6) verdict = { cls: 'warn', text: 'A little long. See if any words can be shown in the pictures instead.' };
    else verdict = { cls: 'bad', text: 'This is long for a picture book. Try trimming — let the pictures do some of the telling.' };
    const gd = Words.gradeDescription(st.grade);
    const mins = st.minutes < 1 ? 'less than a minute' : `about ${Math.round(st.minutes)} minute${Math.round(st.minutes) === 1 ? '' : 's'}`;
    const chip = (n, label) => `<button class="chip" data-go="${n}" data-tip="Go to page ${n}">${label || 'p.' + n}</button>`;
    const filled = st.storyPages.length - st.emptyStory.length;

    $('#tab-story').innerHTML = `
      <div class="card stat-hero">
        <div class="stat-num" id="total-words">${st.total.toLocaleString()}</div>
        <div class="stat-label">words in your story</div>
        <div class="meter" data-tip="The line shows your word goal (${goal}). You can change it in Book Details.">
          <div class="meter-fill ${verdict.cls}" style="width:${pct}%"></div>
          <div class="meter-goal" style="left:${goalPct}%"><span>goal ${goal}</span></div>
        </div>
        <p class="verdict ${verdict.cls}">${verdict.text}</p>
      </div>
      <div class="card two-col">
        <div><div class="mini-stat">⏱️</div><div class="ms-label">Read-aloud time</div><div class="ms-val">${st.total ? mins : '—'}</div></div>
        <div><div class="mini-stat">📄</div><div class="ms-label">Story pages with words</div><div class="ms-val">${filled} of ${st.storyPages.length}</div></div>
      </div>
      <div class="card">
        <h4>📚 Reading level</h4>
        <div class="level">${gd.label}</div>
        <p class="muted small">${gd.detail}</p>
      </div>
      ${st.emptyStory.length && st.total ? `<div class="card"><h4>📝 Story pages still empty</h4><div class="chips">${st.emptyStory.map((n) => chip(n)).join('')}</div></div>` : ''}
      ${st.busy.length ? `<div class="card warn-card"><h4>🧺 Busy pages</h4><p class="muted small">These pages have more than 60 words. Picture book pages usually have far fewer.</p><div class="chips">${st.busy.map((x) => chip(x.n, `p.${x.n} · ${x.w} words`)).join('')}</div></div>` : ''}
      ${st.longSentences.length ? `<div class="card warn-card"><h4>🐍 Long sentences</h4><p class="muted small">Sentences with 20+ words can be hard to read aloud. Try splitting them.</p>
        ${st.longSentences.slice(0, 6).map((x) => `<button class="sentence" data-go="${x.n}"><span class="pill">p.${x.n}</span> “${esc(x.s.slice(0, 90))}${x.s.length > 90 ? '…' : ''}”</button>`).join('')}</div>` : ''}
      ${st.bigWords.size ? `<div class="card"><h4>🐘 Big words <span class="muted small">(3+ syllables)</span></h4><p class="muted small">Big words can be fun! Just make sure young readers will understand them.</p>
        <div class="chips">${[...st.bigWords.entries()].slice(0, 24).map(([w, n]) => `<button class="chip word" data-go="${n}" data-tip="Found on page ${n}">${esc(w)}</button>`).join('')}</div></div>` : ''}
      ${st.repeated.length ? `<div class="card"><h4>🔁 Words you use a lot</h4><p class="muted small">Repeating on purpose is great in picture books. This list helps you spot accidental repeats.</p>
        <div class="chips">${st.repeated.map(([w, c]) => `<span class="chip static">${esc(w)} <b>×${c}</b></span>`).join('')}</div></div>` : ''}
      <div class="card tip-card"><h4>💡 Tip</h4><p>${TIPS[Math.floor(Date.now() / 60000) % TIPS.length]}</p></div>`;
  }

  // ============================================================
  //  RHYMES and BEATS
  // ============================================================
  function showRhymes(word) {
    const out = $('#rhyme-results');
    const w = Words.clean(word);
    if (!w) { out.innerHTML = '<p class="muted">Type a word first.</p>'; return; }
    $('#rhyme-input').value = w;
    const r = Words.rhymes(w);
    const group = (arr) => {
      const by = { 1: [], 2: [], 3: [] };
      for (const x of arr) by[Math.min(3, x.syl)].push(x);
      return [1, 2, 3].filter((k) => by[k].length).map((k) => `
        <div class="rh-group"><div class="rh-label">${k === 1 ? '1 beat' : k === 2 ? '2 beats' : '3+ beats'}</div>
        <div class="chips">${by[k].map((x) => `<button class="chip rhyme ${x.lvl <= 2 ? 'common' : ''}" data-word="${x.w}" data-tip="Click to add “${x.w}” to your page">${x.w}</button>`).join('')}</div></div>`).join('');
    };
    let html = '';
    if (r.perfect.length) html += `<h4>Rhymes with “${esc(w)}”</h4><p class="muted small">Everyday words are shown in <b>bold</b>.</p>${group(r.perfect)}`;
    if (r.close.length) html += `<h4 class="mt">${r.known ? 'Close rhymes (sound similar)' : `Words that end like “${esc(w)}”`}</h4>${group(r.close)}`;
    if (!html) html = `<p>Sorry, I couldn’t find rhymes for “${esc(w)}”. Try a different word.</p>`;
    out.innerHTML = html;
  }

  function insertWord(word) {
    const ed = S.activePage && $(`.page-card[data-page="${S.activePage}"] .pc-text`);
    if (!ed || !S.lastRange) {
      navigator.clipboard?.writeText(word).catch(() => {});
      toast(`📋 Copied “${esc(word)}”. Click on a page and press <b>Ctrl+V</b> to paste it.`);
      return;
    }
    ed.focus();
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(S.lastRange);
    const before = S.lastRange.startContainer.textContent?.slice(0, S.lastRange.startOffset) || '';
    document.execCommand('insertText', false, (before && !/\s$/.test(before) ? ' ' : '') + word);
    toast(`✅ Added “${esc(word)}” to page ${S.activePage}`);
  }

  function lastTypedWord() {
    const n = S.activePage;
    if (!n) return null;
    const ed = $(`.page-card[data-page="${n}"] .pc-text`);
    let text = '';
    if (ed && S.lastRange && ed.contains(S.lastRange.startContainer)) {
      const r = document.createRange();
      r.selectNodeContents(ed);
      r.setEnd(S.lastRange.startContainer, S.lastRange.startOffset);
      text = r.toString();
    }
    if (!Words.words(text).length) text = Words.textOf(S.book.pages[n - 1].text);
    const w = Words.words(text);
    return w.length ? w[w.length - 1] : null;
  }

  function renderBeats() {
    const el = $('#beat-list');
    if (!el || !S.book) return;
    const [a, b] = spreads()[S.spread];
    const n = S.activePage && (S.activePage === a || S.activePage === b) ? S.activePage : (a || b);
    const p = S.book.pages[n - 1];
    const lines = Words.textOf(p.text).split(/\n/).map((l) => l.trim()).filter((l) => Words.words(l).length);
    if (!lines.length) { el.innerHTML = `<p class="muted small">Page ${n} has no words yet. Click on a page and start typing.</p>`; return; }
    const keys = new Map();
    const letters = 'ABCDEFGHIJ';
    const info = lines.map((l) => {
      const ws = Words.words(l);
      const last = ws[ws.length - 1];
      const k = Words.rhymeKey(last) || last.toLowerCase().slice(-2);
      if (!keys.has(k)) keys.set(k, letters[keys.size % letters.length]);
      return { l, beats: ws.reduce((s, w) => s + Words.syllables(w), 0), last, letter: keys.get(k) };
    });
    const counts = {};
    info.forEach((x) => { counts[x.letter] = (counts[x.letter] || 0) + 1; });
    el.innerHTML = `<div class="muted small mb">Page ${n}</div>` + info.map((x) => `
      <div class="beat-line"><span class="beat-num" data-tip="Beats (syllables) in this line">${x.beats}</span>
      <span class="beat-text">${esc(x.l)}</span>
      <span class="rhyme-letter ${counts[x.letter] > 1 ? 'paired l' + x.letter : ''}" data-tip="${counts[x.letter] > 1 ? 'Lines with the same letter rhyme with each other' : 'No rhyming partner on this page'}">${x.letter}</span></div>`).join('');
  }

  // ============================================================
  //  BOOK DETAILS
  // ============================================================
  function renderDetails() {
    const b = S.book;
    const el = $('#tab-details');
    el.innerHTML = `
      <div class="card">
        <label class="lbl" for="d-title">Book title</label>
        <input class="input" id="d-title" value="${esc(b.title)}">
        <label class="lbl" for="d-author">Author name</label>
        <input class="input" id="d-author" value="${esc(b.author)}">
        <label class="lbl" for="d-contact">Your contact details <span class="muted small">(printed on your manuscript PDF)</span></label>
        <textarea class="input" id="d-contact" rows="3" placeholder="Address, email, phone">${esc(b.contact)}</textarea>
      </div>
      <div class="card">
        <label class="lbl" for="d-age">Who is this book for?</label>
        <select class="input" id="d-age">${Object.entries(AGES).map(([k, v]) => `<option value="${k}" ${b.age === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
        <label class="lbl" for="d-goal">Word goal</label>
        <div class="row"><input class="input" type="number" min="20" step="10" id="d-goal" value="${b.wordGoal}"><span class="muted small">words</span></div>
        <label class="lbl">Book size</label>
        <div class="row"><b>${b.pages.length} pages</b><button class="btn subtle" id="d-size">Change…</button></div>
      </div>
      <div class="card">
        <label class="lbl" for="d-pitch">What is your story about? <span class="muted small">(one or two sentences)</span></label>
        <textarea class="input" id="d-pitch" rows="3" placeholder="e.g. A little bear who can’t fall asleep goes looking for the perfect bedtime.">${esc(b.pitch)}</textarea>
      </div>
      <div class="card">
        <h4>🧸 Characters</h4>
        <div id="char-list"></div>
        <button class="btn" id="char-add">＋ Add a character</button>
      </div>
      <div class="card">
        <label class="lbl" for="d-notes">📌 My notes and ideas</label>
        <textarea class="input" id="d-notes" rows="6" placeholder="Anything you want to remember…">${esc(b.notes)}</textarea>
      </div>`;
    const bind = (id, key, after) => $(id).addEventListener('input', (e) => { b[key] = e.target.value; markDirty(); if (after) after(e.target.value); });
    bind('#d-title', 'title', (v) => { $('#book-title').value = v; document.title = `${v} — Picture Book Writer`; });
    bind('#d-author', 'author');
    bind('#d-contact', 'contact', (v) => localStorageSet('pbw.contact', v));
    bind('#d-pitch', 'pitch');
    bind('#d-notes', 'notes');
    $('#d-goal').addEventListener('input', (e) => { b.wordGoal = Math.max(20, +e.target.value || 500); markDirty(); scheduleStats(); });
    $('#d-age').addEventListener('change', (e) => {
      b.age = e.target.value;
      b.wordGoal = AGES[b.age].goal;
      $('#d-goal').value = b.wordGoal;
      markDirty();
      scheduleStats();
    });
    $('#d-size').addEventListener('click', changeSize);
    $('#char-add').addEventListener('click', () => { b.characters.push({ id: uid(), name: '', about: '' }); markDirty(); renderChars(true); });
    renderChars();
  }

  function renderChars(focusLast) {
    const list = $('#char-list');
    const chars = S.book.characters;
    list.innerHTML = chars.length ? chars.map((c, i) => `
      <div class="char" data-i="${i}">
        <input class="input" placeholder="Name (e.g. Benny the Bear)" value="${esc(c.name)}" data-k="name">
        <textarea class="input" rows="2" placeholder="What are they like? What do they want?" data-k="about">${esc(c.about)}</textarea>
        <button class="btn link danger-text" data-del="${i}">Remove</button>
      </div>`).join('') : '<p class="muted small">Keep track of who’s in your story.</p>';
    list.oninput = (e) => {
      const i = +e.target.closest('.char').dataset.i;
      chars[i][e.target.dataset.k] = e.target.value;
      markDirty();
    };
    list.onclick = async (e) => {
      const d = e.target.closest('[data-del]');
      if (!d) return;
      chars.splice(+d.dataset.del, 1);
      markDirty();
      renderChars();
    };
    if (focusLast) $$('.char input', list).pop()?.focus();
  }

  async function changeSize() {
    const b = S.book;
    const opts = [12, 16, 24, 32, 40, 48];
    const n = await modal({
      title: 'Change the number of pages',
      body: `<p>Picture books are printed in groups of 8 pages, so most are 24, 32 or 40 pages long.</p>
        <div class="size-grid">${opts.map((o) => `<button class="size-card ${o === b.pages.length ? 'selected' : ''}" data-n="${o}"><span class="sc-title">${o} pages</span></button>`).join('')}</div>`,
      onOpen: (w, close) => $$('.size-card', w).forEach((c) => c.addEventListener('click', () => close(+c.dataset.n))),
      buttons: [{ label: 'Cancel', value: null }],
    });
    if (!n || n === b.pages.length) return;
    if (n < b.pages.length) {
      const removed = b.pages.slice(n);
      const hasContent = removed.some((p) => Words.textOf(p.text).trim() || p.art.trim() || p.image);
      if (hasContent) {
        const ok = await modal({ title: '⚠️ Some pages will be removed', body: `<p>Pages ${n + 1}–${b.pages.length} have words or pictures on them. They will be deleted.</p>`, buttons: [{ label: 'Keep my pages', value: false, primary: true }, { label: 'Remove them', value: true, danger: true }] });
        if (!ok) return;
      }
      b.pages = b.pages.slice(0, n);
    } else {
      while (b.pages.length < n) b.pages.push(makePage('story'));
    }
    markDirty();
    renderSpread();
    renderMap();
    renderDetails();
    updateStats();
    toast(`📏 Your book now has ${n} pages.`);
  }

  // ============================================================
  //  PREVIEW (flip through like a real book)
  // ============================================================
  function previewPageHTML(n, side) {
    if (!n) return `<div class="pv-page ${side} pv-cover"></div>`;
    const p = S.book.pages[n - 1];
    let text = Words.textOf(p.text).trim() ? p.text : '';
    if (!text && p.role === 'title') text = `<div class="pv-title-page"><div class="pvt">${esc(S.book.title)}</div><div class="pva">by ${esc(S.book.author)}</div></div>`;
    else if (!text && p.role === 'copyright') text = `<div class="pv-small">Text © ${new Date().getFullYear()} ${esc(S.book.author)}</div>`;
    const pic = p.image ? `<img src="${p.image}" alt="">` : (p.art.trim() ? `<div class="pv-note">🎨 ${esc(p.art)}</div>` : '');
    const isTitleLike = p.role === 'title' || p.role === 'copyright' || p.role === 'dedication';
    return `<div class="pv-page ${side} ${isTitleLike ? 'center' : ''} pos-${p.textPos}" data-page="${n}">
      ${pic ? `<div class="pv-pic">${pic}</div>` : ''}
      ${text ? `<div class="pv-text">${text}</div>` : ''}
      <div class="pv-num">${n}</div></div>`;
  }

  function renderPreview(dir) {
    const sp = spreads();
    S.previewSpread = Math.max(0, Math.min(S.previewSpread, sp.length - 1));
    const [a, b] = sp[S.previewSpread];
    const L = a ? S.book.pages[a - 1] : null;
    const book = $('#pv-book');
    let html;
    if (L && b && L.joinWithNext) {
      const R = S.book.pages[b - 1];
      const pic = L.image ? `<img src="${L.image}" alt="">` : (L.art.trim() ? `<div class="pv-note">🎨 ${esc(L.art)}</div>` : '');
      html = `<div class="pv-spread joined">${pic ? `<div class="pv-pic wide">${pic}</div>` : ''}
        <div class="pv-texts"><div class="pv-text" data-page="${a}">${Words.textOf(L.text).trim() ? L.text : ''}</div><div class="pv-text" data-page="${b}">${Words.textOf(R.text).trim() ? R.text : ''}</div></div>
        <div class="pv-num l">${a}</div><div class="pv-num r">${b}</div></div>`;
    } else {
      html = `<div class="pv-spread">${previewPageHTML(a, 'left')}${previewPageHTML(b, 'right')}</div>`;
    }
    book.innerHTML = html;
    book.classList.remove('turn-next', 'turn-prev');
    void book.offsetWidth;
    if (dir) book.classList.add(dir > 0 ? 'turn-next' : 'turn-prev');
    $('#pv-title').textContent = S.book.title;
    $('#pv-count').textContent = a && b ? `Pages ${a}–${b} of ${S.book.pages.length}  ·  Use the arrow keys ← → to turn pages` : `Page ${a || b} of ${S.book.pages.length}  ·  Use the arrow keys ← → to turn pages`;
    $('#pv-prev').disabled = S.previewSpread === 0;
    $('#pv-next').disabled = S.previewSpread === sp.length - 1;
  }

  function openPreview() {
    if (!S.book) return;
    S.previewSpread = S.spread;
    $('#preview').hidden = false;
    renderPreview();
  }
  function closePreview() {
    stopReading();
    $('#preview').hidden = true;
    goSpread(S.previewSpread);
  }
  function previewTurn(d) {
    const n = S.previewSpread + d;
    if (n < 0 || n >= spreads().length) return;
    S.previewSpread = n;
    renderPreview(d);
  }

  // ============================================================
  //  READ ALOUD
  // ============================================================
  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    const en = voices.filter((v) => /^en/i.test(v.lang));
    const pref = ['Samantha', 'Jenny', 'Aria', 'Zira', 'Google US English', 'Karen', 'Daniel', 'Serena'];
    for (const name of pref) { const v = en.find((x) => x.name.includes(name)); if (v) return v; }
    return en.find((v) => v.localService) || en[0] || voices[0] || null;
  }

  function startReading(fromPreview) {
    if (!S.book) return;
    if (!('speechSynthesis' in window)) { toast('Sorry, reading aloud isn’t available on this computer.'); return; }
    stopReading();
    const startSpread = fromPreview ? S.previewSpread : S.spread;
    const queue = [];
    spreads().slice(startSpread).forEach(([a, b], idx) => {
      for (const n of [a, b]) {
        if (!n) continue;
        const t = Words.textOf(S.book.pages[n - 1].text).replace(/\s+/g, ' ').trim();
        if (t) queue.push({ n, t, spread: startSpread + idx });
      }
    });
    if (!queue.length) { toast('There are no words to read yet on these pages.'); return; }
    S.readQueue = { queue, i: 0, fromPreview };
    $('#read-bar').hidden = false;
    speakNext();
  }

  function speakNext() {
    const rq = S.readQueue;
    if (!rq) return;
    if (rq.i >= rq.queue.length) { stopReading(); toast('📖 The end! That was your whole story.'); return; }
    const item = rq.queue[rq.i];
    if (rq.fromPreview) { if (S.previewSpread !== item.spread) { const d = item.spread - S.previewSpread; S.previewSpread = item.spread; renderPreview(d); } }
    else if (S.spread !== item.spread) goSpread(item.spread);
    $$('.reading').forEach((x) => x.classList.remove('reading'));
    $$(`[data-page="${item.n}"]`).forEach((x) => { if (x.matches('.page-card, .pv-page, .pv-text')) x.classList.add('reading'); });
    $('#read-status').textContent = `Reading page ${item.n}…`;
    const u = new SpeechSynthesisUtterance(item.t);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = +$('#read-speed').value;
    u.pitch = 1.05;
    u.onend = () => { if (S.readQueue === rq) { rq.i++; setTimeout(speakNext, 450); } };
    u.onerror = () => { if (S.readQueue === rq) { rq.i++; setTimeout(speakNext, 100); } };
    speechSynthesis.speak(u);
  }

  function stopReading() {
    S.readQueue = null;
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
    $('#read-bar').hidden = true;
    $$('.reading').forEach((x) => x.classList.remove('reading'));
  }

  // ============================================================
  //  PDF
  // ============================================================
  async function makePDF() {
    if (!S.book) return;
    let kind = 'manuscript';
    const res = await modal({
      title: '📄 Make a PDF',
      wide: true,
      body: `<p>Choose the kind of PDF you’d like. ${isWeb() ? 'A print window will open — choose <b>Save as PDF</b> there.' : 'It will be saved on your <b>Desktop</b>.'}</p>
        <div class="pdf-grid">
          <button class="pdf-card selected" data-kind="manuscript">
            <span class="pdf-icon">✉️</span><span class="pdf-title">Manuscript</span>
            <span class="pdf-sub">The standard typed format to <b>send to publishers or agents</b>. Double-spaced, with your contact details and word count.</span>
          </button>
          <button class="pdf-card" data-kind="dummy">
            <span class="pdf-icon">📖</span><span class="pdf-title">Book layout (dummy)</span>
            <span class="pdf-sub">Your book laid out <b>page by page, like a real book</b>, with your pictures and picture ideas. Great for printing and reading to kids.</span>
          </button>
        </div>
        <div class="pdf-opts" id="ms-opts">
          <label><input type="checkbox" id="o-pages" checked> Show where each page breaks (e.g. [Page 5])</label>
          <label><input type="checkbox" id="o-art" checked> Include my picture ideas (art notes)</label>
          ${S.book.contact.trim() ? '' : '<p class="hint">💡 Tip: add your contact details in <b>Book Details</b> so they appear on the manuscript.</p>'}
        </div>`,
      onOpen: (w) => {
        $$('.pdf-card', w).forEach((c) => c.addEventListener('click', () => {
          $$('.pdf-card', w).forEach((x) => x.classList.remove('selected'));
          c.classList.add('selected');
          kind = c.dataset.kind;
          $('#ms-opts', w).style.visibility = kind === 'manuscript' ? 'visible' : 'hidden';
        }));
      },
      buttons: [{ label: 'Cancel', value: null }, { label: 'Make my PDF', primary: true, value: (w) => ({ kind, pages: $('#o-pages', w).checked, art: $('#o-art', w).checked }) }],
    });
    if (!res) return;
    toast('⏳ Making your PDF…', 10000);
    try {
      let r;
      if (res.kind === 'manuscript') {
        r = await api.makePDF({ html: Exporter.manuscriptHTML(S.book, { pageNumbers: res.pages, includeArt: res.art, pageTurns: true }), fileBase: `${S.book.title} - Manuscript` });
      } else {
        r = await api.makePDF({ html: Exporter.dummyHTML(S.book, spreads()), fileBase: `${S.book.title} - Book Layout`, landscape: false });
      }
      $('#toast').classList.remove('show');
      if (r.printed) {
        await modal({
          title: '📄 Saving your PDF',
          body: `<p>In the print window, set <b>Destination</b> (or <b>Printer</b>) to <b>Save as PDF</b>, then click <b>Save</b> and choose your <b>Desktop</b>.</p><p class="muted small">You can also print it on paper from the same window.</p>`,
          buttons: [{ label: 'Got it', primary: true, value: null }],
        });
        return;
      }
      const act = await modal({
        title: '🎉 Your PDF is ready!',
        body: `<p>It’s saved on your <b>Desktop</b> as:</p><p class="file-name">📄 ${esc(r.fileName)}</p>`,
        buttons: [{ label: 'Done', value: null }, { label: 'Show me where', value: 'show' }, { label: 'Open the PDF', primary: true, value: 'open' }],
      });
      if (act === 'open') api.openFile(r.path);
      if (act === 'show') api.showFile(r.path);
    } catch (err) {
      $('#toast').classList.remove('show');
      modal({ title: 'The PDF couldn’t be made', body: `<p>${esc(err.message || err)}</p>` });
    }
  }

  // ============================================================
  //  REARRANGE PAGES
  // ============================================================
  // Pages move as "pieces": a single page, or two pages that share one big picture.
  const sorter = { history: [], focus: null, dragFrom: null };

  function pieces() {
    const out = [];
    const pg = S.book.pages;
    for (let i = 0; i < pg.length; i++) {
      if (pg[i].joinWithNext && i + 1 < pg.length) { out.push([pg[i], pg[i + 1]]); i++; } else out.push([pg[i]]);
    }
    return out;
  }

  // Two pages can only share a picture when they face each other (left page = even number).
  function fixJoins() {
    const split = [];
    S.book.pages.forEach((p, i) => {
      if (!p.joinWithNext) return;
      const n = i + 1;
      if (n % 2 === 1 || n === S.book.pages.length) { p.joinWithNext = false; split.push(n); }
    });
    return split;
  }

  function movePiece(from, to) {
    const list = pieces();
    if (from === to || to < 0 || to > list.length) return;
    sorter.history.push({ pages: S.book.pages.slice(), joins: S.book.pages.map((x) => x.joinWithNext) });
    const [item] = list.splice(from, 1);
    list.splice(to > from ? to - 1 : to, 0, item);
    S.book.pages = list.flat();
    const split = fixJoins();
    sorter.focus = item[0].id;
    markDirty();
    renderSorter();
    const n = S.book.pages.indexOf(item[0]) + 1;
    toast(split.length
      ? `Moved to page ${n}. The big two-page picture was split because those pages no longer face each other.`
      : `✅ Moved to ${item.length > 1 ? `pages ${n}–${n + 1}` : `page ${n}`}`);
  }

  function sorterTile(piece, idx, total) {
    const first = S.book.pages.indexOf(piece[0]) + 1;
    const joined = piece.length > 1;
    const p = piece[0];
    const words = piece.reduce((s, x) => s + pageWords(x), 0);
    const snippet = piece.map((x) => Words.textOf(x.text).trim()).join(' ').slice(0, 90);
    const label = p.role === 'story' ? '' : `<span class="so-role">${ROLES[p.role]}</span>`;
    return `<div class="so-tile ${joined ? 'wide' : ''} ${sorter.focus === p.id ? 'focus' : ''}" draggable="true" data-piece="${idx}">
      <div class="so-thumb">${p.image ? `<img src="${p.image}" alt="">` : ''}${label}<span class="so-snip">${esc(snippet) || '<i class="muted">empty page</i>'}</span></div>
      <div class="so-foot">
        <button class="so-arrow" data-dir="-1" data-tip="Move one step earlier" ${idx === 0 ? 'disabled' : ''}>◀</button>
        <span class="so-num">${joined ? `Pages ${first}–${first + 1}` : `Page ${first}`}<span class="muted"> · ${words}w</span></span>
        <button class="so-arrow" data-dir="1" data-tip="Move one step later" ${idx === total - 1 ? 'disabled' : ''}>▶</button>
      </div></div>`;
  }

  function renderSorter() {
    const list = pieces();
    const grid = $('#so-grid');
    // Group pieces into spreads so the layout looks like the book.
    const groups = [];
    let page = 1;
    let cur = { pieces: [], first: 1 };
    groups.push({ cover: true, pieces: [] });
    list.forEach((pc, idx) => {
      const g = page === 1 ? groups[0] : (page % 2 === 0 ? (cur = { pieces: [] }, groups.push(cur), cur) : cur);
      g.pieces.push([pc, idx]);
      page += pc.length;
    });
    grid.innerHTML = groups.map((g, gi) => `
      <div class="so-spread">
        ${g.cover ? '<div class="so-tile cover-slot"><span>Inside of cover</span></div>' : ''}
        ${g.pieces.map(([pc, idx]) => sorterTile(pc, idx, list.length)).join('')}
        ${gi === groups.length - 1 && !g.cover && g.pieces.reduce((s, [pc]) => s + pc.length, 0) === 1 ? '<div class="so-tile cover-slot"><span>Inside of cover</span></div>' : ''}
      </div>`).join('');
    $('#so-undo').disabled = !sorter.history.length;
    const f = $('.so-tile.focus', grid);
    if (f) f.scrollIntoView({ block: 'nearest' });
  }

  function openSorter(focusPage) {
    if (!S.book) return;
    stopReading();
    sorter.history = [];
    sorter.focus = focusPage ? S.book.pages[focusPage - 1].id : null;
    $('#sorter').hidden = false;
    renderSorter();
  }

  function closeSorter() {
    $('#sorter').hidden = true;
    const focusIdx = sorter.focus ? S.book.pages.findIndex((p) => p.id === sorter.focus) : -1;
    renderMap();
    updateStats();
    if (focusIdx >= 0) goSpread(spreadOfPage(focusIdx + 1)); else renderSpread();
  }

  function wireSorter() {
    const grid = $('#so-grid');
    $('#btn-rearrange').addEventListener('click', () => openSorter());
    $('#so-done').addEventListener('click', closeSorter);
    $('#so-undo').addEventListener('click', () => {
      const prev = sorter.history.pop();
      if (!prev) return;
      S.book.pages = prev.pages;
      prev.pages.forEach((x, i) => { x.joinWithNext = prev.joins[i]; });
      markDirty();
      renderSorter();
      toast('↩ Move undone');
    });
    grid.addEventListener('click', (e) => {
      const a = e.target.closest('.so-arrow');
      if (!a) return;
      const idx = +a.closest('.so-tile').dataset.piece;
      const dir = +a.dataset.dir;
      const list = pieces();
      if (list[idx].length > 1) {
        // A two-page picture jumps a whole spread, so it stays on facing pages.
        const first = S.book.pages.indexOf(list[idx][0]) + 1;
        const at = (pageNum) => { const i = list.findIndex((pc) => S.book.pages.indexOf(pc[0]) + 1 === pageNum); return i < 0 ? list.length : i; };
        movePiece(idx, dir > 0 ? at(first + 4) : at(first - 2));
      } else {
        movePiece(idx, dir > 0 ? idx + 2 : idx - 1);
      }
    });
    grid.addEventListener('dragstart', (e) => {
      const t = e.target.closest('.so-tile[data-piece]');
      if (!t) return;
      sorter.dragFrom = +t.dataset.piece;
      t.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.dataset.piece);
    });
    const clearMarks = () => $$('.drop-before, .drop-after', grid).forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    const dropSpot = (e) => {
      const t = e.target.closest('.so-tile[data-piece]');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      const after = e.clientX > r.left + r.width / 2;
      return { t, to: +t.dataset.piece + (after ? 1 : 0), after };
    };
    grid.addEventListener('dragover', (e) => {
      if (sorter.dragFrom === null) return;
      e.preventDefault();
      clearMarks();
      const d = dropSpot(e);
      if (d) d.t.classList.add(d.after ? 'drop-after' : 'drop-before');
    });
    grid.addEventListener('drop', (e) => {
      e.preventDefault();
      const d = dropSpot(e);
      clearMarks();
      const from = sorter.dragFrom;
      sorter.dragFrom = null;
      if (d && from !== null) movePiece(from, d.to);
    });
    grid.addEventListener('dragend', () => { sorter.dragFrom = null; clearMarks(); $$('.dragging', grid).forEach((x) => x.classList.remove('dragging')); });
  }

  // ============================================================
  //  HELP and TOUR
  // ============================================================
  function showHelp() {
    const where = isWeb()
      ? `<p>${S.info.fs ? 'Your book is a <b>.pbook</b> file on your computer, saved where you chose when you created it (usually the <b>Desktop</b>). It also appears in the list on the first screen.' : 'In this browser, books are kept inside the browser. Click <b>Save</b> to also download a copy (it goes to your Downloads folder). For saving straight to your Desktop, use <b>Google Chrome</b> or <b>Microsoft Edge</b>.'}</p>`
      : S.filePath ? `<p>This book is saved here:<br><span class="file-name">📄 ${esc(S.filePath)}</span></p><button class="btn" id="h-show">Show me the file</button>` : '<p>Books are saved on your <b>Desktop</b> unless you choose somewhere else.</p>';
    modal({
      title: '❓ Help & Tips',
      wide: true,
      body: `
        <div class="help-grid">
          <div class="help-item"><h4>💾 Where is my book saved?</h4>${where}<p class="muted small">Your book saves itself every few seconds while you work. You can also click <b>Save</b> any time.</p></div>
          <div class="help-item"><h4>📂 How do I open my book again?</h4><p>Open Picture Book Writer — your books are listed on the first screen. Click one to open it, or use <b>Open a book from another folder</b>. ${isWeb() ? '' : 'You can also <b>double-click the book file</b> on your Desktop.'}</p></div>
          <div class="help-item"><h4>📖 What is a “spread”?</h4><p>When you open a book, you see two pages side by side — that’s a spread. Each time the reader turns the page, they see a new spread. The <b>Book Map</b> on the left shows every spread.</p></div>
          <div class="help-item"><h4>🔀 How do I move pages around?</h4><p>Click <b>Rearrange pages</b> at the top of the Book Map (or <b>🔀 Move</b> on any page). Drag a page to its new spot, or use the ◀ ▶ arrows. Made a mistake? Click <b>Undo</b>.</p></div>
          <div class="help-item"><h4>🎨 I’m not an illustrator!</h4><p>That’s normal! Most picture book writers don’t draw. Just describe the picture in the <b>Picture idea</b> box. Publishers find the illustrator.</p></div>
          <div class="help-item"><h4>🎵 Writing in rhyme?</h4><p>Open the <b>Rhymes</b> tab on the right. Type a word to find rhymes, and use the <b>Beat counter</b> to check each line has a similar rhythm.</p></div>
          <div class="help-item"><h4>📄 Sending to a publisher?</h4><p>Click <b>Make a PDF</b> and choose <b>Manuscript</b>. It creates the standard format publishers expect.</p></div>
          <div class="help-item"><h4>🔍 Text too small?</h4><p>Press <b>Ctrl</b> and <b>+</b> together to make everything bigger, or <b>Ctrl</b> and <b>–</b> to make it smaller. (On a Mac, use <b>⌘</b>.)</p></div>
          <div class="help-item"><h4>↩️ Made a mistake?</h4><p>Press <b>Ctrl+Z</b> to undo (⌘+Z on a Mac). Spelling mistakes are underlined in red — right-click them for suggestions.</p></div>
        </div>`,
      onOpen: (w, close) => {
        const s = $('#h-show', w); if (s) s.addEventListener('click', () => api.showFile(S.filePath));
        const t = document.createElement('button');
        t.className = 'btn primary big';
        t.textContent = '🧭 Show me around (tour)';
        t.onclick = () => { close(); if (S.book) startTour(); else toast('Open or start a book first, then take the tour.'); };
        $('.modal-buttons', w).prepend(t);
      },
      buttons: [{ label: 'Close', value: null }],
    });
  }

  const TOUR = [
    { sel: '#book-title', title: 'Your book’s title', text: 'Click here any time to change the name of your book.' },
    { sel: '#spread', title: 'Write your pages here', text: 'These are two pages side by side, just like an open book. Type your words in the white boxes. Add a picture idea for the illustrator above.' },
    { sel: '.stage-top', title: 'Turn the pages', text: 'Use <b>Next ▶</b> and <b>◀ Back</b> to move through your book.' },
    { sel: '#bookmap', title: 'The Book Map', text: 'See your whole book at a glance. Click any pages to jump straight to them.' },
    { sel: '#helper', title: 'Your story helper', text: 'Word count, reading level and handy tips. The <b>Rhymes</b> tab finds rhyming words, and <b>Book Details</b> holds your characters and notes.' },
    { sel: '#tb-preview', title: 'Preview your book', text: 'Flip through your book full-screen, just like a reader would.' },
    { sel: '#tb-read', title: 'Hear your story', text: 'The computer reads your story out loud so you can hear how it flows.' },
    { sel: '#tb-pdf', title: 'Make a PDF', text: 'Create a manuscript to send to publishers, or a printable book layout.' },
    { sel: '#save-status', title: 'Saving is automatic', text: 'Your book saves itself as you type. This tells you where it’s saved.' },
  ];

  function startTour(i = 0) {
    const t = $('#tour');
    if (i >= TOUR.length) { t.hidden = true; localStorageSet('pbw.toured', '1'); toast('🎉 You’re all set. Happy writing!'); return; }
    const step = TOUR[i];
    const target = $(step.sel);
    if (!target) return startTour(i + 1);
    const r = target.getBoundingClientRect();
    t.hidden = false;
    t.innerHTML = `<div class="tour-hole" style="left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px"></div>
      <div class="tour-bubble"><div class="tour-step">Step ${i + 1} of ${TOUR.length}</div><h3>${step.title}</h3><p>${step.text}</p>
      <div class="tour-btns"><button class="btn subtle" data-t="skip">Skip tour</button>${i ? '<button class="btn" data-t="back">◀ Back</button>' : ''}<button class="btn primary" data-t="next">${i === TOUR.length - 1 ? 'Finish' : 'Next ▶'}</button></div></div>`;
    const bub = $('.tour-bubble', t);
    const bw = 360;
    const bh = bub.offsetHeight;
    let x = r.right + 18;
    let y = r.top;
    if (x + bw > window.innerWidth - 10) x = r.left - bw - 18;
    if (x < 10) { x = Math.min(Math.max(10, r.left + r.width / 2 - bw / 2), window.innerWidth - bw - 10); y = r.bottom + 18; }
    if (y + bh > window.innerHeight - 10) y = Math.max(10, r.top - bh - 18);
    if (r.height > window.innerHeight * 0.6) y = Math.max(10, r.top + 60);
    bub.style.left = x + 'px';
    bub.style.top = y + 'px';
    t.onclick = (e) => {
      const a = e.target.dataset.t;
      if (a === 'next') startTour(i + 1);
      if (a === 'back') startTour(i - 1);
      if (a === 'skip') { t.hidden = true; localStorageSet('pbw.toured', '1'); }
    };
  }

  // ============================================================
  //  Commands, keyboard, startup
  // ============================================================
  function command(cmd) {
    if (cmd === 'new') return newBookWizard();
    if (cmd === 'open') return openFromDialog();
    if (cmd === 'home') return showHome();
    if (cmd === 'help') return showHelp();
    if (cmd === 'tour') { if (S.book) startTour(); else toast('Open or start a book first, then take the tour.'); return; }
    if (!S.book) { if (['save', 'saveAs', 'pdf', 'preview', 'read'].includes(cmd)) toast('Open or start a book first.'); return; }
    if (cmd === 'save') return saveNow();
    if (cmd === 'saveAs') return saveCopyAs();
    if (cmd === 'pdf') return makePDF();
    if (cmd === 'preview') return openPreview();
    if (cmd === 'rearrange') return openSorter();
    if (cmd === 'read') return startReading(false);
  }

  function wireGlobal() {
    $('#btn-home-new').addEventListener('click', newBookWizard);
    $('#btn-home-open').addEventListener('click', openFromDialog);
    $('#tb-home').addEventListener('click', showHome);
    $('#tb-save').addEventListener('click', () => saveNow());
    $('#tb-preview').addEventListener('click', openPreview);
    $('#tb-read').addEventListener('click', () => (S.readQueue ? stopReading() : startReading(false)));
    $('#tb-pdf').addEventListener('click', makePDF);
    $('#tb-help').addEventListener('click', showHelp);
    $('#pv-close').addEventListener('click', closePreview);
    $('#pv-prev').addEventListener('click', () => previewTurn(-1));
    $('#pv-next').addEventListener('click', () => previewTurn(1));
    $('#pv-read').addEventListener('click', () => (S.readQueue ? stopReading() : startReading(true)));
    $('#read-stop').addEventListener('click', stopReading);
    $('#map-list').addEventListener('click', (e) => { const m = e.target.closest('.map-item'); if (m) goSpread(+m.dataset.spread); });
    $('#helper').addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (tab) {
        $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
        $$('.tab-body').forEach((b) => { b.hidden = b.id !== 'tab-' + tab.dataset.tab; });
        if (tab.dataset.tab === 'rhyme') renderBeats();
        return;
      }
      const go = e.target.closest('[data-go]');
      if (go) goPage(+go.dataset.go);
      const rw = e.target.closest('.chip.rhyme');
      if (rw) insertWord(rw.dataset.word);
    });
    // Keep the caret where it was when clicking rhyme chips.
    $('#tab-rhyme').addEventListener('mousedown', (e) => { if (e.target.closest('.chip.rhyme')) e.preventDefault(); });
    $('#rhyme-go').addEventListener('click', () => showRhymes($('#rhyme-input').value));
    $('#rhyme-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') showRhymes(e.target.value); });
    $('#rhyme-last').addEventListener('mousedown', (e) => e.preventDefault());
    $('#rhyme-last').addEventListener('click', () => {
      const w = lastTypedWord();
      if (w) showRhymes(w); else toast('Click on a page with some words first.');
    });

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); command('save'); return; }
      if (!$('#preview').hidden) {
        if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); previewTurn(1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); previewTurn(-1); }
        if (e.key === 'Escape') closePreview();
        return;
      }
      if (!$('#sorter').hidden) { if (e.key === 'Escape') closeSorter(); return; }
      if (!$('#tour').hidden && e.key === 'Escape') { $('#tour').hidden = true; return; }
      const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
      if (S.book && !typing && !$('#modal-root').children.length) {
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { if (S.spread < spreads().length - 1) goSpread(S.spread + 1); }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { if (S.spread > 0) goSpread(S.spread - 1); }
      }
      if (S.book && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        goSpread(Math.max(0, Math.min(spreads().length - 1, S.spread + (e.key === 'ArrowRight' ? 1 : -1))));
      }
    });
    window.addEventListener('resize', () => { if (!$('#tour').hidden) $('#tour').hidden = true; });

    api.onMenu(command);
    window.addEventListener('beforeunload', (e) => {
      if (isWeb() && S.book && S.dirty) { autoSave(); e.preventDefault(); e.returnValue = ''; }
    });
    api.onOpenPath((p) => openPath(p));
    api.onBeforeClose(async () => {
      stopReading();
      if (S.book && S.dirty) {
        if (S.filePath) {
          const ok = await saveNow({ quiet: true });
          if (!ok) {
            const leave = await modal({ title: 'Your latest changes couldn’t be saved', body: '<p>Close anyway?</p>', buttons: [{ label: 'Stay', value: false, primary: true }, { label: 'Close anyway', value: true, danger: true }] });
            if (!leave) return;
          }
        } else {
          await api.writeRecovery({ book: S.book, at: Date.now() });
          const r = await modal({
            title: 'Save your book before closing?',
            body: '<p>This book hasn’t been saved yet.</p>',
            buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Don’t save', value: 'discard', danger: true }, { label: 'Save', value: 'save', primary: true }],
            dismissValue: 'cancel',
          });
          if (r === 'cancel') return;
          if (r === 'save' && !(await saveFirstTime())) return;
          if (r === 'discard') await api.clearRecovery();
        }
      }
      api.readyToClose();
    });
  }

  async function init() {
    S.info = await api.info();
    wireGlobal();
    wireEditor();
    wireSorter();
    if (S.info.pendingOpenPath) await openPath(S.info.pendingOpenPath);
    else await showHome();
  }

  // Exposed for the automated demo / tests only.
  window.__pbw = {
    S, goSpread, goPage, openSorter, movePiece, showRhymes, insertWord, previewTurn, startTour, spreads, markDirty,
    refreshAll: () => { renderSpread(); renderMap(); renderDetails(); updateStats(); },
  };

  init();
})();
