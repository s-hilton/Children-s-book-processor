// Builds printable HTML for the PDF exports.
(function () {
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function totalWords(book) {
    return book.pages.filter((p) => !['title', 'copyright', 'dedication'].includes(p.role)).reduce((n, p) => n + Words.words(Words.textOf(p.text)).length, 0);
  }

  function roundedWords(n) {
    if (n < 100) return String(n);
    return String(Math.round(n / 10) * 10);
  }

  // ---------- Manuscript: the standard format publishers and agents expect ----------
  function manuscriptHTML(book, opts) {
    const words = totalWords(book);
    const contact = esc(book.contact || '').replace(/\n/g, '<br>');
    let body = '';
    let lastWasStory = false;
    book.pages.forEach((p, i) => {
      const hasText = Words.textOf(p.text).trim().length > 0;
      const hasArt = opts.includeArt && String(p.art || '').trim();
      if (p.role !== 'story' && !hasText) return;
      if (!hasText && !hasArt) return;
      let block = '';
      if (opts.pageNumbers) block += `<div class="pg">[Page ${i + 1}${opts.pageTurns && (i + 1) % 2 === 1 && i + 1 < book.pages.length ? ' — page turn' : ''}]</div>`;
      else if (lastWasStory) block += '<div class="gap"></div>';
      if (hasArt) block += `<div class="art">[Art note: ${esc(p.art)}]</div>`;
      if (hasText) block += `<div class="txt">${p.text}</div>`;
      body += `<section class="pgblock">${block}</section>`;
      lastWasStory = true;
    });
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: Letter; margin: 1in; }
      body { font-family: "Times New Roman", Times, serif; font-size: 12pt; color: #000; margin: 0; }
      .head { display: flex; justify-content: space-between; line-height: 1.25; }
      .title { text-align: center; margin: 2.6in 0 0.5in; line-height: 2; }
      .title h1 { font-size: 12pt; font-weight: normal; text-transform: uppercase; margin: 0; }
      .txt, .art { line-height: 2; }
      .txt div, .txt p { margin: 0; }
      .art { font-style: italic; }
      .pg { margin-top: 24pt; color: #000; }
      .gap { height: 24pt; }
      .pgblock { break-inside: avoid; }
      .end { text-align: center; margin-top: 36pt; }
    </style></head><body>
      <div class="head"><div>${esc(book.author)}<br>${contact}</div><div>${roundedWords(words)} words</div></div>
      <div class="title"><h1>${esc(book.title || 'Untitled')}</h1><div>by ${esc(book.author || '')}</div></div>
      ${body}
      <div class="end">THE END</div>
    </body></html>`;
  }

  // ---------- Dummy: see the book laid out as real spreads ----------
  function pageBox(book, p, n, side) {
    if (!p) return '<div class="pg empty"></div>';
    const img = p.image ? `<img src="${p.image}">` : `<div class="note">${esc(p.art || '').replace(/\n/g, '<br>') || '<span class="faint">(picture)</span>'}</div>`;
    const text = Words.textOf(p.text).trim() ? `<div class="text">${p.text}</div>` : '';
    const top = p.textPos === 'top';
    return `<div class="pg ${side}">
      ${top ? text : ''}<div class="pic">${img}</div>${top ? '' : text}
      <div class="num">${n}</div></div>`;
  }

  function dummyHTML(book, spreads) {
    let html = '';
    for (const [a, b] of spreads) {
      const L = a ? book.pages[a - 1] : null;
      const R = b ? book.pages[b - 1] : null;
      if (L && R && L.joinWithNext) {
        const img = L.image ? `<img src="${L.image}">` : `<div class="note">${esc(L.art || '').replace(/\n/g, '<br>') || '<span class="faint">(one picture across both pages)</span>'}</div>`;
        const tl = Words.textOf(L.text).trim() ? `<div class="text">${L.text}</div>` : '<div></div>';
        const tr = Words.textOf(R.text).trim() ? `<div class="text">${R.text}</div>` : '<div></div>';
        html += `<div class="sheet"><div class="spread joined"><div class="pic wide">${img}</div><div class="texts">${tl}${tr}</div>
          <div class="num l">${a}</div><div class="num r">${b}</div></div></div>`;
      } else {
        html += `<div class="sheet"><div class="spread">${pageBox(book, L, a, 'left')}${pageBox(book, R, b, 'right')}</div></div>`;
      }
    }
    return `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: 11in 8.5in; margin: 0; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #222; }
      .sheet { width: 11in; height: 8.5in; display: flex; align-items: center; justify-content: center; page-break-after: always; position: relative; }
      .cover-label { position: absolute; top: .35in; left: 0; right: 0; text-align: center; font: 11pt Georgia, serif; color: #777; }
      .spread { width: 10in; height: 6.25in; display: flex; position: relative; box-shadow: 0 0 0 1px #bbb; }
      .pg { width: 5in; height: 6.25in; padding: .35in; display: flex; flex-direction: column; gap: .2in; position: relative; }
      .pg.left { border-right: 1px dashed #bbb; }
      .pg.empty { background: #f3f3f3; }
      .pic { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 4px; }
      .pic img { width: 100%; height: 100%; object-fit: contain; }
      .note { width: 100%; height: 100%; border: 2px dashed #c9c1b3; border-radius: 6px; padding: .2in; font: italic 11pt Georgia, serif; color: #6b6255; display: flex; align-items: center; justify-content: center; text-align: center; }
      .faint { color: #aaa; }
      .text { font-size: 15pt; line-height: 1.45; text-align: center; }
      .text div, .text p { margin: 0; }
      .num { position: absolute; bottom: .12in; font-size: 9pt; color: #999; left: 0; right: 0; text-align: center; }
      .joined { flex-direction: column; padding: .35in; gap: .2in; }
      .pic.wide { flex: 1; }
      .texts { display: grid; grid-template-columns: 1fr 1fr; gap: .7in; }
      .num.l { left: 0; right: 50%; } .num.r { left: 50%; right: 0; }
      .titlesheet { flex-direction: column; text-align: center; }
      .titlesheet h1 { font-size: 34pt; margin: 0 0 .2in; }
    </style></head><body>
      <div class="sheet titlesheet"><h1>${esc(book.title || 'Untitled')}</h1><div style="font-size:16pt">by ${esc(book.author || '')}</div>
      <div style="margin-top:.4in;color:#777;font-size:11pt">Picture book dummy · ${book.pages.length} pages · ${totalWords(book)} words</div></div>
      ${html}
    </body></html>`;
  }

  window.Exporter = { manuscriptHTML, dummyHTML, totalWords, esc };
})();
