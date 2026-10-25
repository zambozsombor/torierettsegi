/* Érettségi feladatbank – szűrő + pdf.js nézegető (történelem, matematika, magyar) */
(() => {
  'use strict';
  const T = document.body.dataset.t || 'tori';
  const D = { tori: window.TORI, mat: window.DB_MAT, magy: window.DB_MAGY }[T];
  const $ = (s) => document.querySelector(s);
  if (!D) { const st = $('#stat'); if (st) st.textContent = 'Az adatok nem töltődtek be. Töltsd újra az oldalt.'; return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs/pdf.worker.min.js';
  // a PDF-olvasó (worker) azonnali indítása a háttérben, hogy az első megnyitásnál már kész legyen
  let pdfWorker = null;
  try { pdfWorker = new pdfjsLib.PDFWorker(); } catch (e) { pdfWorker = null; }
  let progressCb = null;

  /* ---------- tantárgyankénti beállítások ---------- */
  const TORI_TIPUS = { rovid: 'Rövid választ igénylő', rovidessze: 'Rövid esszé', hosszuessze: 'Hosszú esszé', komplexessze: 'Komplex esszé' };
  const CFG = {
    tori: {
      chips: D.temak || [],
      tipusNev: (f) => TORI_TIPUS[f.tipus] || '',
      csoport: (f) => (f.resz === 'I' ? 'I. Rövid választ igénylő feladatok' : 'II. Esszék'),
      szoveg: (f) => [f.cim, f.tema],
      tag: (k) => (D.temak.find((t) => t.kod === k) || {}).sav || 'x',
      egyseg: 'feladat',
    },
    mat: {
      chips: D.temak || [],
      tipusNev: () => '',
      csoport: (f) => ({ I: 'I. rész', 'II.A': 'II. A rész', 'II.B': 'II. B rész (a három feladatból kettőt kell megoldani)', II: 'II. rész (az öt feladatból négyet kell megoldani)' }[f.resz] || ''),
      szoveg: (f) => [f.cim, ...(f.alt || []), ...(f.ftip || [])],
      tag: () => 'e',
      egyseg: 'feladat',
    },
    magy: {
      chips: (D.tipusok || []).map((t) => ({ kod: t.kod, rovid: t.nev, nev: t.nev })),
      tipusNev: () => '',
      csoport: () => '',
      szoveg: (f) => [f.cim, f.leiras, ...(f.szerzok || [])],
      tag: () => 'm',
      egyseg: 'feladat',
    },
  }[T];

  const vizsgaById = new Map(D.vizsgak.map((v) => [v.id, v]));
  const chipByKod = new Map(CFG.chips.map((t) => [t.kod, t]));
  const HO_SORREND = { 'február': 1, 'május': 2, 'május (idegen nyelvű vizsga, magyar feladatlap)': 2.5, 'október': 3 };

  D.feladatok.forEach((f) => {
    const v = vizsgaById.get(f.v);
    f._v = v;
    if (T === 'magy') f.tks = [f.tipus];
    if (!f.tks) f.tks = [];
    f._sort = v.ev * 100 + (HO_SORREND[v.ho] || 0) * 10;
    f._kulcs = CFG.szoveg(f).filter(Boolean).join(' | ').toLocaleLowerCase('hu');
  });

  /* ---------- állapot ---------- */
  const st = {
    szint: 'k', mod: 'szures', temak: new Set(), tipus: '', tol: null, ig: null, szoveg: '',
    resz: '', alt: '', ftip: '', vEv: null, vIdo: null, aktiv: null, doc: 'fl',
  };
  const evek = [...new Set(D.vizsgak.map((v) => v.ev))].sort((a, b) => a - b);
  st.tol = evek[0]; st.ig = evek[evek.length - 1];

  /* ---------- URL <-> állapot ---------- */
  function readUrl() {
    const q = new URLSearchParams(location.search);
    if (q.get('szint') === 'e') st.szint = 'e';
    if (q.get('tema')) q.get('tema').split(',').forEach((k) => chipByKod.has(k) && st.temak.add(k));
    for (const k of ['tipus', 'resz', 'alt', 'ftip']) if (q.get(k)) st[k] = q.get(k);
    if (q.get('tol')) st.tol = +q.get('tol');
    if (q.get('ig')) st.ig = +q.get('ig');
    if (q.get('q')) st.szoveg = q.get('q');
    if (q.get('vizsga')) { st.mod = 'vizsga'; const v = vizsgaById.get(q.get('vizsga')); if (v) { st.vEv = v.ev; st.vIdo = v.ho; st.szint = v.szint; } }
    if (q.get('doc') === 'ut') st.doc = 'ut';
    return q.get('f');
  }
  function writeUrl() {
    const q = new URLSearchParams();
    if (st.szint === 'e') q.set('szint', 'e');
    if (st.mod === 'szures') {
      if (st.temak.size) q.set('tema', [...st.temak].join(','));
      for (const k of ['tipus', 'resz', 'alt', 'ftip']) if (st[k]) q.set(k, st[k]);
      if (st.tol !== evek[0]) q.set('tol', st.tol);
      if (st.ig !== evek[evek.length - 1]) q.set('ig', st.ig);
      if (st.szoveg) q.set('q', st.szoveg);
    } else {
      const v = aktualisVizsga(); if (v) q.set('vizsga', v.id);
    }
    if (st.aktiv) q.set('f', st.aktiv.id);
    if (st.doc === 'ut') q.set('doc', 'ut');
    const s = q.toString();
    history.replaceState(null, '', s ? '?' + s : location.pathname);
  }

  function toggleTema(k) {
    st.temak.has(k) ? st.temak.delete(k) : st.temak.add(k);
    if (st.mod !== 'szures') setMod('szures'); else render();
  }

  /* ---------- idővonal (történelem) / témasáv (matek, magyar) ---------- */
  function buildTimeline() {
    const axis = $('#tlAxis');
    if (!axis) return;
    axis.appendChild(document.createElement('span'));
    D.korok.forEach((k) => {
      const s = document.createElement('span');
      s.innerHTML = `${k.nev}<small>${k.ido}</small>`;
      axis.appendChild(s);
    });
    for (const [laneId, sav] of [['#laneE', 'e'], ['#laneM', 'm'], ['#laneX', 'x']]) {
      const lane = $(laneId);
      const temak = D.temak.filter((t) => t.sav === sav).sort((a, b) => a.oszlop - b.oszlop);
      let col = 0;
      temak.forEach((t) => {
        while (col < t.oszlop) { const g = document.createElement('div'); g.className = 'tl-gap'; lane.appendChild(g); col++; }
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'seg'; b.dataset.kod = t.kod;
        b.style.gridColumn = `span ${t.span || 1}`;
        b.innerHTML = `<span>${t.rovid}</span><span class="n"></span>`;
        b.title = t.nev;
        b.addEventListener('click', () => toggleTema(t.kod));
        lane.appendChild(b);
        col += t.span || 1;
      });
    }
  }
  function buildBand() {
    const band = $('#band');
    if (!band) return;
    CFG.chips.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'seg'; b.dataset.kod = t.kod;
      b.innerHTML = `${T === 'mat' ? `<span class="rom">${t.kod}.</span>` : ''}<span>${t.rovid}</span><span class="n"></span>`;
      b.title = t.nev;
      b.addEventListener('click', () => toggleTema(t.kod));
      band.appendChild(b);
    });
  }
  function updateSegs() {
    const base = szurt({ temaNelkul: true });
    const cnt = {};
    base.forEach((f) => f.tks.forEach((k) => { cnt[k] = (cnt[k] || 0) + 1; }));
    document.querySelectorAll('.seg').forEach((b) => {
      const n = cnt[b.dataset.kod] || 0;
      b.querySelector('.n').textContent = `${n} ${CFG.egyseg}`;
      b.classList.toggle('off', n === 0);
      b.setAttribute('aria-pressed', st.temak.has(b.dataset.kod));
      // magyar: az adott szinten nem létező feladattípus ne foglaljon helyet
      if (T === 'magy') b.hidden = n === 0 && !st.temak.has(b.dataset.kod) && !D.feladatok.some((f) => f._v.szint === st.szint && f.tipus === b.dataset.kod);
    });
  }

  /* ---------- szűrés ---------- */
  function tipusEgyezik(f, t) {
    if (!t) return true;
    if (t === 'essze') return f.tipus !== 'rovid';
    return f.tipus === t;
  }
  function szurt({ temaNelkul = false, kiveve = null } = {}) {
    const q = st.szoveg.trim().toLocaleLowerCase('hu');
    return D.feladatok.filter((f) => f._v.szint === st.szint
      && f._v.ev >= st.tol && f._v.ev <= st.ig
      && (temaNelkul || !st.temak.size || f.tks.some((k) => st.temak.has(k)))
      && (T !== 'tori' || tipusEgyezik(f, st.tipus))
      && (kiveve === 'resz' || !st.resz || f.resz === st.resz)
      && (kiveve === 'alt' || !st.alt || (f.alt || []).includes(st.alt))
      && (kiveve === 'ftip' || !st.ftip || (f.ftip || []).includes(st.ftip))
      && (!q || f._kulcs.includes(q)));
  }
  function aktualisVizsga() {
    return D.vizsgak.find((v) => v.szint === st.szint && v.ev === st.vEv && v.ho === st.vIdo);
  }
  function lista() {
    if (st.mod === 'vizsga') {
      const v = aktualisVizsga();
      return v ? D.feladatok.filter((f) => f.v === v.id).sort((a, b) => a.sor - b.sor) : [];
    }
    return szurt().sort((a, b) => b._sort - a._sort || a.sor - b.sor);
  }

  /* ---------- vezérlők ---------- */
  function fillSelect(sel, items, val) {
    if (!sel) return;
    sel.innerHTML = items.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
    if (val != null) sel.value = val;
  }
  function on(id, ev, fn) { const el = $(id); if (el) el[ev] = fn; }
  function setVal(id, v) { const el = $(id); if (el) el.value = v; }
  // matek: rész / altémakör / feladattípus listák a többi szűrőhöz igazítva, darabszámmal
  function updateMatSelects() {
    if (T !== 'mat') return;
    const reszek = st.szint === 'k' ? [['I', 'I. rész (rövid feladatok)'], ['II.A', 'II. A rész'], ['II.B', 'II. B rész (választható)']] : [['I', 'I. rész'], ['II', 'II. rész (választható)']];
    if (st.resz && !reszek.some(([v]) => v === st.resz)) st.resz = '';
    const cR = {}; szurt({ kiveve: 'resz' }).forEach((f) => { cR[f.resz] = (cR[f.resz] || 0) + 1; });
    fillSelect($('#fResz'), [['', 'Mind'], ...reszek.map(([v, t]) => [v, `${t} (${cR[v] || 0})`])], st.resz);
    const cA = {}; szurt({ kiveve: 'alt' }).forEach((f) => (f.alt || []).forEach((a) => { cA[a] = (cA[a] || 0) + 1; }));
    if (st.alt && !cA[st.alt]) cA[st.alt] = 0;
    fillSelect($('#fAlt'), [['', 'Mind'], ...Object.keys(cA).sort((a, b) => a.localeCompare(b, 'hu')).map((a) => [a, `${a} (${cA[a]})`])], st.alt);
    const cT = {}; szurt({ kiveve: 'ftip' }).forEach((f) => (f.ftip || []).forEach((a) => { cT[a] = (cT[a] || 0) + 1; }));
    if (st.ftip && !cT[st.ftip]) cT[st.ftip] = 0;
    fillSelect($('#fFtip'), [['', 'Mind'], ...Object.keys(cT).sort((a, b) => a.localeCompare(b, 'hu')).map((a) => [a, `${a} (${cT[a]})`])], st.ftip);
  }
  function initControls() {
    fillSelect($('#fTol'), evek.map((e) => [e, e]), st.tol);
    fillSelect($('#fIg'), evek.map((e) => [e, e]), st.ig);
    setVal('#fTipus', st.tipus);
    setVal('#fSzoveg', st.szoveg);
    on('#fTipus', 'onchange', (e) => { st.tipus = e.target.value; render(); });
    on('#fResz', 'onchange', (e) => { st.resz = e.target.value; render(); });
    on('#fAlt', 'onchange', (e) => { st.alt = e.target.value; render(); });
    on('#fFtip', 'onchange', (e) => { st.ftip = e.target.value; render(); });
    on('#fTol', 'onchange', (e) => { st.tol = +e.target.value; if (st.ig < st.tol) { st.ig = st.tol; setVal('#fIg', st.ig); } render(); });
    on('#fIg', 'onchange', (e) => { st.ig = +e.target.value; if (st.tol > st.ig) { st.tol = st.ig; setVal('#fTol', st.tol); } render(); });
    let tmr; on('#fSzoveg', 'oninput', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { st.szoveg = e.target.value; render(); }, 150); });
    on('#reset', 'onclick', () => {
      st.temak.clear(); st.tipus = ''; st.resz = ''; st.alt = ''; st.ftip = ''; st.szoveg = ''; st.tol = evek[0]; st.ig = evek[evek.length - 1];
      initControls(); render();
    });
    document.querySelectorAll('.level button').forEach((b) => {
      b.setAttribute('aria-checked', b.dataset.szint === st.szint);
      b.onclick = () => {
        st.szint = b.dataset.szint;
        if (st.aktiv && st.aktiv._v.szint !== st.szint) {
          st.aktiv = null; shown.url = null; shown.token++;
          $('#vCim').textContent = 'Válassz egy feladatot'; $('#vMeta').textContent = '';
          pagesEl.innerHTML = '<div class="empty"><p>Válassz egy feladatot a listából.</p></div>';
        }
        document.querySelectorAll('.level button').forEach((x) => x.setAttribute('aria-checked', x === b));
        syncVizsgaSelects(); render();
      };
    });
    $('#tabSzures').onclick = () => setMod('szures');
    $('#tabVizsga').onclick = () => setMod('vizsga');
    $('#vEv').onchange = (e) => { st.vEv = +e.target.value; syncVizsgaSelects(); render(); };
    $('#vIdo').onchange = (e) => { st.vIdo = e.target.value; render(); };
  }
  function syncVizsgaSelects() {
    const vk = D.vizsgak.filter((v) => v.szint === st.szint);
    const ev = [...new Set(vk.map((v) => v.ev))].sort((a, b) => b - a);
    if (!ev.includes(st.vEv)) st.vEv = ev[0];
    fillSelect($('#vEv'), ev.map((e) => [e, e]), st.vEv);
    const idok = vk.filter((v) => v.ev === st.vEv).sort((a, b) => HO_SORREND[a.ho] - HO_SORREND[b.ho]).map((v) => v.ho);
    if (!idok.includes(st.vIdo)) st.vIdo = idok[0];
    fillSelect($('#vIdo'), idok.map((h) => [h, h]), st.vIdo);
  }
  function setMod(m) {
    st.mod = m;
    $('#tabSzures').setAttribute('aria-selected', m === 'szures');
    $('#tabVizsga').setAttribute('aria-selected', m === 'vizsga');
    $('#paneSzures').hidden = m !== 'szures';
    $('#paneVizsga').hidden = m !== 'vizsga';
    if (m === 'vizsga') syncVizsgaSelects();
    render();
  }

  /* ---------- lista ---------- */
  function vizsgaNev(v) { return `${v.ev}. ${v.ho}`; }
  function metaTags(f) {
    const meta = [];
    if (T === 'magy') {
      if (f.szerzok && f.szerzok.length && !/:/.test(f.cim)) meta.push(esc(f.szerzok.slice(0, 3).join(', ')));
    } else {
      f.tks.forEach((k) => { const t = chipByKod.get(k); if (t) meta.push(`<span class="tag ${CFG.tag(k)}">${esc(t.rovid)}</span>`); });
    }
    if (T === 'mat' && f.alt && f.alt.length) meta.push(esc(f.alt.slice(0, 2).join(', ')));
    const tn = CFG.tipusNev(f); if (tn) meta.push(tn);
    if (f.pont) meta.push(`${f.pont} pont`);
    return meta.join(' ');
  }
  function render() {
    updateSegs();
    updateMatSelects();
    const L = lista();
    st.lista = L;
    const act = $('#activeTema');
    if (act) {
      act.innerHTML = '';
      [...st.temak].forEach((k) => {
        const b = document.createElement('button');
        b.className = 'chip'; b.type = 'button'; b.textContent = chipByKod.get(k).rovid;
        b.title = 'Szűrő eltávolítása';
        b.onclick = () => { st.temak.delete(k); render(); };
        act.appendChild(b);
      });
    }
    $('#count').textContent = `${L.length} ${CFG.egyseg}`;
    const ol = $('#results');
    ol.innerHTML = '';
    if (!L.length) { ol.innerHTML = '<li class="none">Nincs a szűrésnek megfelelő feladat. Bővítsd az évek körét, vagy vegyél ki egy szűrőt.</li>'; }
    let lastGroup = null;
    const frag = document.createDocumentFragment();
    L.forEach((f) => {
      const grp = st.mod === 'vizsga' ? CFG.csoport(f) : vizsgaNev(f._v);
      if (grp && grp !== lastGroup) { const g = document.createElement('li'); g.className = 'groupname'; g.textContent = grp; frag.appendChild(g); lastGroup = grp; }
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.id = f.id;
      if (st.aktiv && st.aktiv.id === f.id) b.setAttribute('aria-current', 'true');
      const sub = T === 'magy' && f.leiras ? `<span class="r-sub">${esc(f.leiras)}</span>` : '';
      b.innerHTML = `<span class="r-no">${f.n}.</span><span class="r-cim">${esc(f.cim)}</span>${sub}<span class="r-meta">${metaTags(f)}</span>`;
      b.onclick = () => open(f);
      li.appendChild(pg.check(f)); li.appendChild(b); frag.appendChild(li);
    });
    ol.appendChild(frag);
    $('#stat').textContent = `${D.feladatok.filter((f) => f._v.szint === st.szint).length} ${st.szint === 'k' ? 'középszintű' : 'emelt szintű'} ${CFG.egyseg}, ${evek[0]}–${evek[evek.length - 1]}`;
    pg.paint();
    writeUrl();
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------- nézegető ---------- */
  const docs = new Map();
  function getDoc(url) {
    if (!docs.has(url)) {
      const task = pdfjsLib.getDocument({ url, worker: pdfWorker || undefined, disableRange: true, isEvalSupported: false });
      task.onProgress = (p) => { if (progressCb) progressCb(p); };
      docs.set(url, task.promise.catch((e) => { docs.delete(url); throw e; }));
      // legfeljebb 12 dokumentum maradjon a memóriában (a legrégebbit eldobjuk, ha nem az látszik)
      if (docs.size > 12) { for (const [k, pr] of docs) { if (k !== shown.url && k !== url) { docs.delete(k); pr.then((d) => d.destroy()).catch(() => {}); break; } } }
    }
    return docs.get(url);
  }
  let shown = { url: null, width: 0, holders: [], scale: 1, token: 0, obs: null };
  const pagesEl = $('#pages');

  async function buildDoc(url) {
    const token = ++shown.token;
    pagesEl.innerHTML = '<div class="loading">Feladat betöltése…</div>';
    progressCb = (p) => { const el = pagesEl.querySelector('.loading'); if (el && p.loaded) el.textContent = `Feladat betöltése… ${Math.round(p.loaded / 1024)} KB`; };
    const pdf = await getDoc(url);
    if (token !== shown.token) return false;
    const p1 = await pdf.getPage(1);
    const vp1 = p1.getViewport({ scale: 1 });
    const width = Math.min(pagesEl.clientWidth - 24, 980);
    const scale = width / vp1.width;
    pagesEl.innerHTML = '';
    if (shown.obs) shown.obs.disconnect();
    const holders = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const h = document.createElement('div');
      h.className = 'pageholder';
      h.style.width = `${width}px`; h.style.height = `${vp1.height * scale}px`;
      h.dataset.page = i;
      pagesEl.appendChild(h); holders.push(h);
    }
    pagesEl.style.paddingTop = '12px';
    const obs = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) renderPage(pdf, e.target, scale, token); }), { root: pagesEl, rootMargin: '800px 0px' });
    shown = { url, width, holders, scale, token, obs, pdf };
    return true;
  }
  async function renderPage(pdf, h, scale, token) {
    if (h.dataset.done) return;
    h.dataset.done = '1';
    const page = await pdf.getPage(+h.dataset.page);
    if (token !== shown.token) return;
    const vp = page.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
    h.style.height = `${vp.height}px`;
    h.appendChild(c);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null }).promise;
  }
  async function show() {
    const f = st.aktiv; if (!f) return;
    const v = f._v;
    const slice = st.doc === 'fl' && f.fs;
    const url = slice ? f.fs[0] : v[st.doc];
    if (!url) { shown.url = null; pagesEl.innerHTML = '<div class="empty"><p>Ehhez a vizsgához nincs javítási útmutató a gyűjteményben.</p></div>'; return; }
    const pos = slice ? [f.fs[1], f.fs[2]] : (f[st.doc] || [1, 0]);
    const width = Math.min(pagesEl.clientWidth - 24, 980);
    if (shown.url !== url || Math.abs(shown.width - width) > 2) {
      const ok = await buildDoc(url).catch((e) => { pagesEl.innerHTML = '<div class="empty"><p>A feladat nem tölthető be. Ha közben frissült az oldal, töltsd újra.</p><p><button type="button" class="linkbtn" onclick="location.reload()">Oldal újratöltése</button></p></div>'; console.error(e); return false; });
      if (!ok) return;
    }
    const h = shown.holders[pos[0] - 1];
    if (!h) return;
    // a cél és a következő oldal azonnal
    await renderPage(shown.pdf, h, shown.scale, shown.token);
    if (shown.holders[pos[0]]) renderPage(shown.pdf, shown.holders[pos[0]], shown.scale, shown.token);
    pagesEl.scrollTop = h.offsetTop + pos[1] * shown.scale - 10;
    if (!shown.observing) { shown.observing = true; requestAnimationFrame(() => shown.holders.forEach((x) => shown.obs.observe(x))); }
    $('#vOpen').href = slice ? f.fs[0] : `${v[st.doc]}#page=${(f[st.doc] || [1])[0]}`;
    // előtöltés a háttérben: a másik fül (útmutató / feladat), valamint a lista előző és következő feladata
    const pre = [];
    if (st.doc === 'fl') pre.push(v.ut); else pre.push(f.fs ? f.fs[0] : v.fl);
    const L = st.lista || []; const i = L.findIndex((x) => x.id === f.id);
    [L[i + 1], L[i - 1]].forEach((x) => { if (x) pre.push(x.fs ? x.fs[0] : x._v.fl); });
    setTimeout(() => pre.filter(Boolean).forEach((u) => getDoc(u).catch(() => {})), 300);
  }
  function open(f, keepDoc) {
    st.aktiv = f;
    if (!keepDoc) st.doc = 'fl';
    document.querySelectorAll('.doc button').forEach((b) => b.setAttribute('aria-selected', b.dataset.doc === st.doc));
    $('#vCim').textContent = `${f.n}. ${f.cim}`;
    const t0 = chipByKod.get(f.tk);
    const parts = [`${vizsgaNev(f._v)}, ${f._v.szint === 'k' ? 'középszint' : 'emelt szint'}`];
    if (T === 'tori') parts.push(CFG.tipusNev(f), f.pont ? `${f.pont} pont` : '', f.tema || (t0 && t0.nev), f.hiv ? '' : 'saját besorolás');
    if (T === 'mat') parts.push(f.tks.map((k) => (chipByKod.get(k) || {}).rovid).join(', '), (f.alt || []).join(', '), f.pont ? `${f.pont} pont` : '', f.gepi ? 'gépi témakör-besorolás' : '');
    if (T === 'magy') parts.push(f.pont ? `${f.pont} pont` : '', (f.szerzok || []).join(', '));
    $('#vMeta').textContent = parts.filter(Boolean).join(' | ');
    document.querySelectorAll('.results button').forEach((b) => b.toggleAttribute('aria-current', b.dataset.id === f.id));
    document.body.classList.add('viewing');
    pg.paint();
    writeUrl();
    show();
  }
  document.querySelectorAll('.doc button').forEach((b) => {
    b.onclick = () => { st.doc = b.dataset.doc; document.querySelectorAll('.doc button').forEach((x) => x.setAttribute('aria-selected', x === b)); writeUrl(); show(); };
  });
  function step(d) {
    const L = st.lista || []; if (!st.aktiv) return;
    const i = L.findIndex((f) => f.id === st.aktiv.id);
    const n = L[i + d]; if (n) open(n, true);
  }
  $('#vPrev').onclick = () => step(-1);
  $('#vNext').onclick = () => step(1);
  $('#vBack').onclick = () => document.body.classList.remove('viewing');
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,select')) return;
    if (e.key === 'ArrowRight' && e.altKey) step(1);
    if (e.key === 'ArrowLeft' && e.altKey) step(-1);
  });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (st.aktiv && Math.abs(shown.width - Math.min(pagesEl.clientWidth - 24, 980)) > 2) show(); }, 250); });


  /* ---------- haladás (papaimatek.hu fiók: auth.js / Supabase) ---------- */
  const pg = (() => {
    const PM = window.PM;
    const done = {};
    let user = null;
    const key = (f) => `e:${T}:${f.id}`;
    const doneBtn = document.createElement('button');
    doneBtn.type = 'button'; doneBtn.className = 'pm-done'; doneBtn.hidden = true;
    const nav = document.querySelector('.vbar .nav'); if (nav) nav.insertBefore(doneBtn, nav.firstChild);
    function toggle(f) {
      if (!PM) return;
      if (!user) { if (PM.openLogin) PM.openLogin(); return; }
      const k = key(f); const now = !done[k]; done[k] = now; paint();
      PM.saveProgress(k, { status: now ? 'kesz' : '' });
    }
    doneBtn.onclick = () => { if (st.aktiv) toggle(st.aktiv); };
    function check(f) {
      const c = document.createElement('button');
      c.type = 'button'; c.className = 'pm-check'; c.dataset.key = key(f);
      c.title = 'Kész / nincs kész'; c.setAttribute('aria-label', `${f.n}. feladat kész`);
      c.onclick = (e) => { e.stopPropagation(); toggle(f); };
      if (!PM) c.hidden = true;
      return c;
    }
    function paint() {
      document.querySelectorAll('.pm-check').forEach((c) => { const on = !!done[c.dataset.key]; c.classList.toggle('on', on); c.textContent = on ? '✓' : ''; c.setAttribute('aria-pressed', on); });
      if (PM && st.aktiv) { const on = !!done[key(st.aktiv)]; doneBtn.hidden = false; doneBtn.classList.toggle('on', on); doneBtn.textContent = on ? '✓ Kész' : 'Kész'; }
      const line = $('#progressLine');
      if (line) {
        if (PM && user) {
          const all = D.feladatok.filter((f) => f._v.szint === st.szint);
          const n = all.filter((f) => done[key(f)]).length;
          line.textContent = `Megoldva: ${n} / ${all.length} ${st.szint === 'k' ? 'középszintű' : 'emelt szintű'} ${CFG.egyseg}`;
        } else line.textContent = PM ? 'Jelentkezz be, és pipáld ki a megoldott feladatokat – a haladásod el lesz mentve.' : '';
      }
    }
    function refresh() {
      PM.loadProgress().then((map) => {
        Object.keys(done).forEach((k) => delete done[k]);
        Object.keys(map || {}).forEach((k) => { if (k.startsWith(`e:${T}:`) && map[k].status === 'kesz') done[k] = true; });
        paint();
      });
    }
    if (PM) {
      PM.onChange((u) => { user = u; if (u) refresh(); else { Object.keys(done).forEach((k) => delete done[k]); paint(); } });
      PM.getUser().then((u) => { user = u; if (u) refresh(); else paint(); });
    }
    return { check, paint };
  })();

  /* ---------- indulás ---------- */
  const fid = readUrl();
  buildTimeline();
  buildBand();
  initControls();
  setMod(st.mod);
  if (fid) { const f = D.feladatok.find((x) => x.id === fid); if (f) { const d = st.doc; open(f, true); st.doc = d; } }
  if (!fid) document.body.classList.remove('viewing');
})();
