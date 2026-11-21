// Records the walkthrough demo video of Picture Book Writer.
// Needs: Linux with Xvfb, ffmpeg, festival (text2wave) + festvox-us-slt-hts, pdftoppm, Playwright.
// Usage: xvfb-run -a -s "-screen 0 1440x900x24" node demo/record-demo.js <workDir> <output.mp4>
const { _electron } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORK = path.resolve(process.argv[2] || path.join(ROOT, 'demo-work'));
const OUT = path.resolve(process.argv[3] || path.join(ROOT, 'demo', 'Picture-Book-Writer-Demo.mp4'));
const HOME = path.join(WORK, 'home');
const DESKTOP = path.join(HOME, 'Desktop');
const AUDIO = path.join(WORK, 'audio');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(DESKTOP, { recursive: true });
fs.mkdirSync(AUDIO, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- narration ----------------
let clipN = 0;
function tts(text) {
  const file = path.join(AUDIO, `clip${String(clipN++).padStart(3, '0')}.wav`);
  const plain = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/…/g, '...').replace(/—/g, ', ');
  fs.writeFileSync(file + '.txt', plain);
  execFileSync('text2wave', ['-eval', '(voice_cmu_us_slt_arctic_hts)', file + '.txt', '-o', file]);
  const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
  return { file, dur };
}

const STORY = {
  6: '“Too hungry!” Benny grumbled.\nHe padded out the door.',
  7: 'He sniffed along the riverbank\nand found… a berry store!',
  8: 'He munched a pile of blueberries,\nthen plums, and then a pear.',
  9: 'Now Benny was too full to sleep —\npoor, puffed-up little bear!',
  10: 'He counted stars. He counted sheep.\nHe counted twenty frogs.',
  11: 'Then Owl hooted softly,\n“Try a song beside the logs.”',
  12: 'So Benny hummed his tummy tune,\nso soft and low and deep…',
  13: '…until the moon was smiling down\non Benny, fast asleep.',
};
const ART = {
  6: 'Benny stomps out of the cave, tummy first.',
  7: 'A riverbank glowing with berry bushes. Benny’s eyes are HUGE.',
  9: 'Benny lying on his back, round as a ball.',
  10: 'Speech-bubble thoughts full of stars, sheep and frogs.',
  11: 'A wise little owl on a branch above some logs.',
  12: 'Wide night scene: Benny curled by the logs, Owl watching, the moon smiling.',
};

const timeline = []; // { file, at } in ms from video start
let t0 = 0;
const now = () => Date.now() - t0;

(async () => {
  console.log('Generating narration…');
  const lines = {};
  const say = (k, text) => { lines[k] = { text, ...tts(text) }; };
  say('welcome', 'Welcome to Picture Book Writer: a word processor made just for writing children’s picture books. Everything is big, friendly, and easy to find.');
  say('new', 'To begin, click Start a new book.');
  say('wizard', 'Give your book a name, and type your name as the author. Then pick how many pages. Thirty-two pages is the most common size for a picture book.');
  say('desktop', 'Your book is saved on your Desktop automatically, and it keeps saving itself as you write. So you never have to worry about losing your work.');
  say('tour', 'The first time you start, a short guided tour shows you around. You can take it again any time from the Help button.');
  say('spread', 'Here is your book, open to pages four and five. Two pages side by side, just like a real open book.');
  say('type', 'Click on a page, and start typing your story.');
  say('art', 'Not an illustrator? No problem. Describe the picture in the yellow box, as a note for the illustrator.');
  say('img', 'Or, if you have a sketch or a picture, you can add it to the page.');
  say('rhyme1', 'Writing in rhyme? Open the Rhymes tab, and type a word to find words that rhyme with it. Everyday words are shown in bold.');
  say('rhyme2', 'Click a rhyme, and it’s added right where you were typing.');
  say('beats', 'The beat counter shows the number of syllables in each line. Lines with the same colored letter rhyme with each other.');
  say('later', 'A little later, more of the story is written.');
  say('map', 'The Book Map on the left shows your whole book at a glance. Click any pages to jump straight to them.');
  say('turn', 'Under each pair of pages, a page turn reminder helps you end with a reason to keep reading.');
  say('joined', 'For a big moment, tick, one picture across both pages, to plan a wide illustration.');
  say('check', 'The Story Check keeps count of your words, and tells you the reading level and how long it takes to read aloud. It also points out busy pages and long sentences.');
  say('details', 'Book Details keeps your contact information, characters, and notes all in one place.');
  say('preview', 'Click Preview Book to flip through your story full screen, just like a reader would.');
  say('read', 'And Read Aloud has the computer read your story to you, so you can hear how it flows.');
  say('pdf1', 'When you are ready to share, click Make a PDF. Choose Manuscript, the standard format that publishers and agents expect, or a printable book layout.');
  say('pdf2', 'The PDF is saved on your Desktop, ready to print or send.');
  say('home', 'To come back later, open Picture Book Writer. All the books on your Desktop are listed right here. Just click one to carry on writing. You can also double click the book file on your Desktop.');
  say('bye', 'Picture Book Writer. Happy writing!');
  const readTexts = [12, 13].map((n) => STORY[n].replace(/\s+/g, ' ').trim());
  const readClips = {};
  for (const t of readTexts) readClips[t] = tts(t);

  console.log('Launching app…');
  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    args: [ROOT, '--no-sandbox'],
    env: { ...process.env, HOME, XDG_CONFIG_HOME: path.join(HOME, '.config') },
    recordVideo: { dir: path.join(WORK, 'video'), size: { width: 1440, height: 900 } },
  });
  const win = await app.firstWindow();
  t0 = Date.now();
  win.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForSelector('#home:not([hidden])');
  await wait(400);

  // Overlay: captions, a visible cursor, end card.
  await win.addStyleTag({ content: `
    #demo-cap { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); max-width: 1080px; width: max-content; z-index: 100000;
      background: rgba(30,32,50,.92); color: #fff; font: 600 22px/1.4 Nunito, sans-serif; padding: 14px 26px; border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0,0,0,.3); text-align: center; transition: opacity .3s; }
    #demo-cap:empty { opacity: 0; }
    .toast { bottom: 120px !important; }
    #demo-cursor { position: fixed; left: 720px; top: 450px; width: 28px; height: 28px; z-index: 100001; pointer-events: none;
      transition: left .6s cubic-bezier(.4,0,.2,1), top .6s cubic-bezier(.4,0,.2,1); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
    .demo-ripple { position: fixed; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; border: 4px solid #E9765A;
      z-index: 100000; pointer-events: none; animation: demoRip .5s ease-out forwards; }
    @keyframes demoRip { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.4); opacity: 0; } }
    #demo-shot { position: fixed; inset: 0; z-index: 99990; background: rgba(30,32,50,.86); display: flex; align-items: center; justify-content: center; gap: 30px; padding: 40px 40px 120px; }
    #demo-shot img { max-height: 100%; max-width: 48%; border-radius: 6px; box-shadow: 0 20px 50px rgba(0,0,0,.5); background: #fff; }
    #demo-end { position: fixed; inset: 0; z-index: 99995; background: #FBF6EC; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
    #demo-end h1 { font-size: 60px; margin: 0; } #demo-end p { font-size: 26px; color: #5C5F77; margin: 0; }
  ` });
  await win.evaluate(() => {
    const cap = document.createElement('div'); cap.id = 'demo-cap'; document.body.appendChild(cap);
    const cur = document.createElement('div'); cur.id = 'demo-cursor';
    cur.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.9L4 20z" fill="#fff" stroke="#2B2D42" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cur);
    window.__cap = (t) => { cap.textContent = t; };
    window.__cursor = (x, y) => { cur.style.left = x + 'px'; cur.style.top = y + 'px'; };
    window.__ripple = (x, y) => { const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); };
  });

  // ---- helpers ----
  async function narrate(key, action, { caption, pad = 450 } = {}) {
    const clip = lines[key];
    await win.evaluate((t) => window.__cap(t), caption || clip.text);
    const start = now();
    timeline.push({ file: clip.file, at: start });
    if (action) await action();
    const remaining = clip.dur * 1000 + pad - (now() - start);
    if (remaining > 0) await wait(remaining);
  }
  async function pointAt(sel, dx = 0.5, dy = 0.5) {
    await win.locator(sel).first().scrollIntoViewIfNeeded();
    const box = await win.locator(sel).first().boundingBox();
    const x = box.x + box.width * dx;
    const y = box.y + box.height * dy;
    await win.evaluate(([a, b]) => window.__cursor(a, b), [x, y]);
    await wait(650);
    return { x, y };
  }
  async function click(sel, opts = {}) {
    const { x, y } = await pointAt(sel, opts.dx, opts.dy);
    await win.evaluate(([a, b]) => window.__ripple(a, b), [x, y]);
    await win.mouse.click(x, y);
    await wait(opts.after ?? 350);
  }
  async function type(text, delay = 42) {
    for (const part of text.split('\n')) {
      if (part !== text.split('\n')[0]) await win.keyboard.press('Enter');
      await win.keyboard.type(part, { delay });
    }
  }
  async function addPicture(sel, file) {
    const [chooser] = await Promise.all([win.waitForEvent('filechooser'), click(sel)]);
    await chooser.setFiles(file);
    await wait(700);
  }

  // Fake speech (no voices in the recording machine): play our own voice clips with the right timing.
  await win.exposeFunction('__onSpeak', (text) => {
    const key = Object.keys(readClips).find((k) => k.replace(/\W/g, '') === text.replace(/\W/g, ''));
    if (key) timeline.push({ file: readClips[key].file, at: now() });
  });
  const durMap = Object.fromEntries(Object.entries(readClips).map(([k, v]) => [k.replace(/\W/g, ''), v.dur]));
  await win.evaluate((durs) => {
    speechSynthesis.speak = (u) => {
      window.__onSpeak(u.text);
      const d = durs[u.text.replace(/\W/g, '')] || 2;
      setTimeout(() => u.onend && u.onend(), d * 1000 + 200);
    };
    speechSynthesis.cancel = () => {};
  }, durMap);

  // ================= THE DEMO =================
  await narrate('welcome', async () => { await pointAt('.home-hero h1'); });
  await narrate('new', async () => { await click('#btn-home-new', { after: 600 }); });
  await narrate('wizard', async () => {
    await click('#nb-title');
    await type('Benny Can’t Sleep', 55);
    await click('#nb-author');
    await type('Sam Rivers', 55);
    await click('.size-card[data-n="32"]');
  });
  await narrate('desktop', async () => {
    await pointAt('.where-line', 0.3);
    await wait(1500);
    await click('.modal-buttons .btn.primary', { after: 1200 });
  });
  await narrate('tour', async () => {
    await wait(1800);
    await click('.tour-bubble [data-t="next"]', { after: 1800 });
    await click('.tour-bubble [data-t="next"]', { after: 1500 });
    await click('.tour-bubble [data-t="skip"]', { after: 300 });
  });
  await narrate('spread', async () => { await pointAt('.page-card.left .pc-head', 0.2); await wait(700); await pointAt('.page-card.right .pc-head', 0.2); });
  await narrate('type', async () => {
    await click('.page-card.left .pc-text');
    await type('Benny Bear was sleepy.\nHe yawned up at the moon.');
  }, { pad: 200 });
  await narrate('art', async () => {
    await click('.page-card.left .pc-art');
    await type('Benny in his cosy cave, yawning. The moon peeks in.', 30);
  });
  await narrate('img', async () => { await addPicture('.page-card.left .pc-pic-add', path.join(__dirname, 'assets', 'bear-cave.png')); await wait(500); });
  await narrate('rhyme1', async () => {
    await click('.page-card.right .pc-text');
    await type('But when he closed his eyes,\nhis tummy hummed a', 40);
    await click('.tab[data-tab="rhyme"]');
    await click('#rhyme-input');
    await type('moon', 90);
    await click('#rhyme-go', { after: 400 });
  });
  await narrate('rhyme2', async () => {
    await click('.chip.rhyme[data-word="tune"]', { after: 500 });
    await win.locator('.page-card.right .pc-text').evaluate((el) => {
      el.focus();
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await win.keyboard.type('.', { delay: 60 });
  });
  await narrate('beats', async () => { await pointAt('#beat-list', 0.15, 0.3); await wait(800); await pointAt('#beat-list .rhyme-letter', 0.5, 0.5); });

  // Time-lapse: the rest of the story appears.
  await narrate('later', async () => {
    await win.evaluate(([story, art]) => {
      const S = window.__pbw.S;
      for (const [n, t] of Object.entries(story)) {
        S.book.pages[n - 1].text = t.split('\n').map((l) => `<div>${l}</div>`).join('');
      }
      for (const [n, a] of Object.entries(art)) S.book.pages[n - 1].art = a;
      S.book.pages[2].text = '<div>For every little bear who can’t sleep.</div>';
      S.book.characters = [{ id: 'c1', name: 'Benny the Bear', about: 'A cuddly, hungry bear who just can’t get to sleep.' }];
      S.book.pitch = 'A sleepy bear with a rumbly tummy tries everything to fall asleep — until a wise owl suggests a song.';
      S.book.contact = '12 Maple Lane, Springfield\nsam.rivers@example.com';
      window.__pbw.markDirty();
      window.__pbw.refreshAll();
      window.__pbw.goSpread(3);
    }, [STORY, ART]);
    await wait(1200);
    await click('.tab[data-tab="story"]');
  });
  await narrate('map', async () => {
    await pointAt('#map-list', 0.5, 0.3);
    await click('.map-item[data-spread="4"]', { after: 900 });
    await click('.map-item[data-spread="3"]', { after: 400 });
  });
  await narrate('turn', async () => {
    await win.locator('#page-turn-hint').scrollIntoViewIfNeeded();
    await wait(300);
    await pointAt('#page-turn-hint', 0.3);
  });
  await narrate('joined', async () => {
    await win.evaluate(() => { document.querySelector('#stage').scrollTop = 0; });
    await click('.map-item[data-spread="6"]', { after: 600 });
    await click('#join-spread', { after: 700 });
    await addPicture('.joined-pic .pc-pic-add', path.join(__dirname, 'assets', 'night-sky.png'));
  });
  await narrate('check', async () => {
    await pointAt('#total-words');
    await wait(1200);
    await pointAt('.level');
    await wait(900);
    await win.evaluate(() => document.querySelector('#tab-story').scrollTo({ top: 400, behavior: 'smooth' }));
    await wait(1400);
    await win.evaluate(() => document.querySelector('#tab-story').scrollTo({ top: 0, behavior: 'smooth' }));
  });
  await narrate('details', async () => {
    await click('.tab[data-tab="details"]', { after: 800 });
    await win.evaluate(() => document.querySelector('#tab-details').scrollTo({ top: 520, behavior: 'smooth' }));
    await wait(1400);
    await win.evaluate(() => document.querySelector('#tab-details').scrollTo({ top: 0, behavior: 'smooth' }));
    await click('.tab[data-tab="story"]');
  });
  await narrate('preview', async () => {
    await win.evaluate(() => window.__pbw.goSpread(2));
    await click('#tb-preview', { after: 1500 });
    await click('#pv-next', { after: 1500 });
    await click('#pv-next', { after: 1500 });
    await click('#pv-next', { after: 1200 });
  });
  await narrate('read', async () => {
    await click('#pv-next', { after: 1200 });
  });
  // Let the "computer" read pages 12–13.
  await win.evaluate(() => window.__cap('🔊  Read Aloud'));
  await click('#pv-read', { after: 200 });
  const rs = Object.values(readClips).reduce((s, c) => s + c.dur + 0.65, 0);
  await wait(rs * 1000 + 900);
  await click('#pv-close', { after: 600 });

  await narrate('pdf1', async () => {
    await click('#tb-pdf', { after: 1200 });
    await click('.pdf-card[data-kind="dummy"]', { after: 1100 });
    await click('.pdf-card[data-kind="manuscript"]', { after: 800 });
    await click('.modal-buttons .btn.primary', { after: 2200 });
  });
  // Make the book-layout PDF too, quietly, so we can show both.
  await click('.modal-buttons .btn >> text=Done', { after: 200 });
  await win.evaluate(async () => {
    const S = window.__pbw.S;
    await window.bookAPI.makePDF({ html: Exporter.dummyHTML(S.book, window.__pbw.spreads()), fileBase: `${S.book.title} - Book Layout` });
  });
  const ms = fs.readdirSync(DESKTOP).find((f) => f.includes('Manuscript'));
  const dm = fs.readdirSync(DESKTOP).find((f) => f.includes('Book Layout'));
  execFileSync('pdftoppm', ['-r', '90', '-png', '-f', '1', '-l', '1', '-singlefile', path.join(DESKTOP, ms), path.join(WORK, 'ms')]);
  execFileSync('pdftoppm', ['-r', '70', '-png', '-f', '8', '-l', '8', '-singlefile', path.join(DESKTOP, dm), path.join(WORK, 'dm')]);
  const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  await narrate('pdf2', async () => {
    await win.evaluate(([a, b]) => {
      const d = document.createElement('div'); d.id = 'demo-shot';
      d.innerHTML = `<img src="${a}"><img src="${b}">`;
      document.body.appendChild(d);
    }, [b64(path.join(WORK, 'ms.png')), b64(path.join(WORK, 'dm.png'))]);
    await wait(4200);
  }, { pad: 1200 });
  await win.evaluate(() => document.querySelector('#demo-shot').remove());

  await narrate('home', async () => {
    await click('#tb-home', { after: 1500 });
    await pointAt('.book-card', 0.3, 0.3);
    await wait(2200);
    await pointAt('.bc-where');
    await wait(1600);
    await click('.book-card .btn.primary', { after: 1500 });
  });
  await narrate('bye', async () => {
    await win.evaluate(() => {
      const e = document.createElement('div'); e.id = 'demo-end';
      e.innerHTML = `<svg viewBox="0 0 64 64" width="120" height="120"><rect x="6" y="12" width="26" height="40" rx="4" fill="#F28C6B"/><rect x="32" y="12" width="26" height="40" rx="4" fill="#4FA3A5"/><path d="M32 12v40" stroke="#2B2D42" stroke-width="3"/><circle cx="45" cy="26" r="5" fill="#FFD166"/><path d="M12 42c5-7 9-7 14 0" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round"/></svg><h1>Picture Book Writer</h1><p>Happy writing! ✏️</p>`;
      document.body.appendChild(e);
      window.__cap('');
      document.querySelector('#demo-cursor').style.display = 'none';
    });
  }, { pad: 2500 });

  const total = now();
  const vh = await win.evaluate(() => window.innerHeight);
  const video = win.video();
  await app.close().catch(() => {});
  const webm = await video.path();
  console.log('Recorded', webm, 'timeline end', total, 'ms');

  // ---------------- mix narration + video ----------------
  const vdur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', webm]).toString());
  const offset = Math.max(0, vdur * 1000 - total - 150); // video starts slightly before t0
  console.log('video duration', vdur, 'offset', offset);
  const args = ['-y', '-i', webm];
  timeline.forEach((c) => args.push('-i', c.file));
  const filters = timeline.map((c, i) => `[${i + 1}:a]aresample=44100,adelay=${Math.round(c.at + offset)}:all=1[a${i}]`);
  filters.push(`${timeline.map((_, i) => `[a${i}]`).join('')}amix=inputs=${timeline.length}:normalize=0:dropout_transition=0,volume=1.6,apad[aout]`);
  filters.push(`[0:v]crop=1440:${Math.min(900, vh) & ~1}:0:0[vout]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-r', '25',
    '-c:a', 'aac', '-b:a', '160k', '-t', String(vdur), '-movflags', '+faststart', OUT);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  console.log('Wrote', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
