// Word tools: syllables, rhymes and story statistics. Works fully offline.
(function () {
  const byWord = new Map(); // word -> {w, lvl, syl, key}
  const byKey = new Map(); // rhyme key -> [entries]
  for (const rec of (window.WORD_DATA || '').split(';')) {
    const [w, lvl, syl, key] = rec.split(',');
    if (!w) continue;
    const e = { w, lvl: +lvl, syl: +syl, key };
    byWord.set(w, e);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  }

  const clean = (w) => String(w || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z']/g, '').replace(/^'+|'+$/g, '');

  function guessSyllables(word) {
    let w = clean(word).replace(/'/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const m = w.match(/[aeiouy]{1,2}/g);
    return Math.max(1, m ? m.length : 1);
  }

  function syllables(word) {
    const w = clean(word);
    if (!w) return 0;
    const e = byWord.get(w) || byWord.get(w.replace(/'s$/, '')) || byWord.get(w.replace(/'/g, ''));
    return e ? e.syl : guessSyllables(w);
  }

  // Finds rhymes. Returns { perfect: [...], close: [...], known: bool }
  function rhymes(word) {
    const w = clean(word).replace(/'/g, '');
    const e = byWord.get(w);
    if (!e) {
      // Fall back to words that share the same ending letters.
      const end = w.slice(-3);
      const list = end.length >= 2 ? [...byWord.values()].filter((x) => x.w !== w && x.w.endsWith(end)) : [];
      list.sort((a, b) => a.lvl - b.lvl || a.w.length - b.w.length);
      return { known: false, perfect: [], close: list.slice(0, 60) };
    }
    const perfect = (byKey.get(e.key) || []).filter((x) => x.w !== w && !x.w.endsWith(w) && !w.endsWith(x.w));
    perfect.sort((a, b) => a.lvl - b.lvl || a.syl - b.syl || a.w.localeCompare(b.w));
    // Close rhymes: same stressed vowel sound + same final sound, but different middle.
    const parts = e.key.split('-');
    const vowel = parts[0];
    const last = parts[parts.length - 1];
    const close = [];
    if (parts.length > 1) {
      for (const [k, arr] of byKey) {
        if (k === e.key) continue;
        const p = k.split('-');
        if (p[0] === vowel && p[p.length - 1] === last && Math.abs(p.length - parts.length) <= 1) {
          for (const x of arr) if (x.lvl <= 2) close.push(x);
        }
      }
    } else {
      for (const [k, arr] of byKey) {
        const p = k.split('-');
        if (k !== e.key && p[0] === vowel && p.length === 2) for (const x of arr) if (x.lvl <= 1) close.push(x);
      }
    }
    close.sort((a, b) => a.lvl - b.lvl || a.syl - b.syl || a.w.localeCompare(b.w));
    return { known: true, perfect: perfect.slice(0, 150), close: close.slice(0, 40) };
  }

  const STOP = new Set(('a an the and or but so if then than that this these those there here is are was were be been being am do does did done ' +
    'have has had i me my mine you your yours he him his she her hers it its we us our they them their what which who whom whose when where why how ' +
    'all any both each few more most other some such no nor not only own same too very can will just should now of in on at by for with about against ' +
    'between into through during before after above below to from up down out off over under again further once as until while s t don\'t i\'m it\'s ' +
    'said says say go went get got one would could oh').split(/\s+/));

  function textOf(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html || '').replace(/<(div|p|br)[^>]*>/gi, '\n$&');
    return (d.textContent || '').replace(/ /g, ' ');
  }

  const wordRe = /[A-Za-z0-9À-ɏ]+(?:['’][A-Za-z]+)*/g;
  function words(text) { return String(text || '').match(wordRe) || []; }

  function sentences(text) {
    return String(text || '')
      .replace(/\n+/g, ' \n ')
      .split(/(?<=[.!?…]["”’)]?)\s+|\n/)
      .map((s) => s.trim())
      .filter((s) => words(s).length > 0);
  }

  // Flesch–Kincaid grade level
  function gradeLevel(text) {
    const ws = words(text);
    const ss = sentences(text);
    if (ws.length < 10 || ss.length === 0) return null;
    const syl = ws.reduce((n, w) => n + syllables(w), 0);
    const g = 0.39 * (ws.length / ss.length) + 11.8 * (syl / ws.length) - 15.59;
    return Math.max(0, Math.round(g * 10) / 10);
  }

  function gradeDescription(g) {
    if (g === null) return { label: 'Not enough words yet', detail: 'Write a few more sentences and I’ll tell you the reading level.' };
    if (g < 1) return { label: 'Very easy (Pre-K – Kindergarten)', detail: 'Perfect for reading to ages 2–5.' };
    if (g < 2) return { label: 'Easy (Grade 1)', detail: 'Great for ages 4–7 — just right for most picture books.' };
    if (g < 3) return { label: 'Grade 2', detail: 'Good for ages 5–8. Still fine for a picture book read aloud.' };
    if (g < 4) return { label: 'Grade 3', detail: 'Ages 7–9. A little advanced — try shorter sentences or simpler words.' };
    return { label: `Grade ${Math.floor(g)}`, detail: 'This is quite advanced for a picture book. Shorter sentences and smaller words will help.' };
  }

  window.Words = { syllables, rhymes, words, sentences, gradeLevel, gradeDescription, textOf, STOP, clean, isKnown: (w) => byWord.has(clean(w)),
    rhymeKey: (w) => { const e = byWord.get(clean(w).replace(/'/g, '')); return e ? e.key : null; } };
})();
