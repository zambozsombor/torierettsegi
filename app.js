/* Történelem érettségi feladatbank – szűrő + pdf.js nézegető */
(() => {
  'use strict';
  const D = window.TORI;
  const $ = (s) => document.querySelector(s);
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs/pdf.worker.min.js';
  // a PDF-olvasó (worker) azonnali indítása a háttérben, hogy az első megnyitásnál már kész legyen
  let pdfWorker = null;
  try { pdfWorker = new pdfjsLib.PDFWorker(); } catch (e) { pdfWorker = null; }
  let progressCb = null;

  const vizsgaById = new Map(D.vizsgak.map((v) => [v.id, v]));
  const temaByKod = new Map(D.temak.map((t) => [t.kod, t]));
  const HO_SORREND = { 'február': 1, 'május': 2, 'május (idegen nyelvű vizsga, magyar feladatlap)': 2.5, 'október': 3 };
  const TIPUS_NEV = { rovid: 'Rövid választ igénylő', rovidessze: 'Rövid esszé', hosszuessze: 'Hosszú esszé', komplexessze: 'Komplex esszé' };

  D.feladatok.forEach((f) => {
    const v = vizsgaById.get(f.v);
    f._v = v;
    f._sort = v.ev * 100 + (HO_SORREND[v.ho] || 0) * 10;
    f._kulcs = (f.cim || '').toLocaleLowerCase('hu');
  });

  /* ---------- állapot ---------- */
  const st = {
    szint: 'k', mod: 'szures', temak: new Set(), tipus: '', kerdes: '', tol: null, ig: null, szoveg: '',
    vEv: null, vIdo: null, aktiv: null, doc: 'fl',
  };
  const evek = [...new Set(D.vizsgak.map((v) => v.ev))].sort((a, b) => a - b);
  st.tol = evek[0]; st.ig = evek[evek.length - 1];

  /* ---------- URL <-> állapot ---------- */
  function readUrl() {
    const q = new URLSearchParams(location.search);
    if (q.get('szint') === 'e') st.szint = 'e';
    if (q.get('tema')) q.get('tema').split(',').forEach((k) => temaByKod.has(k) && st.temak.add(k));
    if (q.get('tipus')) st.tipus = q.get('tipus');
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
      if (st.tipus) q.set('tipus', st.tipus);
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

  /* ---------- idővonal ---------- */
  function buildTimeline() {
    const axis = $('#tlAxis');
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
        b.addEventListener('click', () => { st.temak.has(t.kod) ? st.temak.delete(t.kod) : st.temak.add(t.kod); if (st.mod !== 'szures') setMod('szures'); render(); });
        lane.appendChild(b);
        col += t.span || 1;
      });
    }
  }
  function updateTimeline() {
    const base = szurt({ temaNelkul: true });
    const cnt = {};
    base.forEach((f) => f.tks.forEach((k) => { cnt[k] = (cnt[k] || 0) + 1; }));
    document.querySelectorAll('.seg').forEach((b) => {
      const n = cnt[b.dataset.kod] || 0;
      b.querySelector('.n').textContent = `${n} feladat`;
      b.classList.toggle('off', n === 0);
      b.setAttribute('aria-pressed', st.temak.has(b.dataset.kod));
    });
  }

  /* ---------- szűrés ---------- */
  function tipusEgyezik(f, t) {
    if (!t) return true;
    if (t === 'essze') return f.tipus !== 'rovid';
    return f.tipus === t;
  }
  function szurt({ temaNelkul = false } = {}) {
    const q = st.szoveg.trim().toLocaleLowerCase('hu');
    return D.feladatok.filter((f) => f._v.szint === st.szint
      && f._v.ev >= st.tol && f._v.ev <= st.ig
      && (temaNelkul || !st.temak.size || f.tks.some((k) => st.temak.has(k)))
      && tipusEgyezik(f, st.tipus)
      && (!q || f._kulcs.includes(q) || (f.tema || '').toLocaleLowerCase('hu').includes(q)));
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
    sel.innerHTML = items.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
    if (val != null) sel.value = val;
  }
  function initControls() {
    fillSelect($('#fTol'), evek.map((e) => [e, e]), st.tol);
    fillSelect($('#fIg'), evek.map((e) => [e, e]), st.ig);
    $('#fTipus').value = st.tipus;
    $('#fSzoveg').value = st.szoveg;
    $('#fTipus').onchange = (e) => { st.tipus = e.target.value; render(); };
    $('#fTol').onchange = (e) => { st.tol = +e.target.value; if (st.ig < st.tol) { st.ig = st.tol; $('#fIg').value = st.ig; } render(); };
    $('#fIg').onchange = (e) => { st.ig = +e.target.value; if (st.tol > st.ig) { st.tol = st.ig; $('#fTol').value = st.tol; } render(); };
    let tmr; $('#fSzoveg').oninput = (e) => { clearTimeout(tmr); tmr = setTimeout(() => { st.szoveg = e.target.value; render(); }, 150); };
    $('#reset').onclick = () => {
      st.temak.clear(); st.tipus = ''; st.szoveg = ''; st.tol = evek[0]; st.ig = evek[evek.length - 1];
      initControls(); render();
    };
    document.querySelectorAll('.level button').forEach((b) => {
      b.setAttribute('aria-checked', b.dataset.szint === st.szint);
      b.onclick = () => { st.szint = b.dataset.szint; if (st.aktiv && st.aktiv._v.szint !== st.szint) { st.aktiv = null; shown.url = null; shown.token++; $('#vCim').textContent = 'Válassz egy feladatot'; $('#vMeta').textContent = ''; pagesEl.innerHTML = '<div class="empty"><p>Válassz egy feladatot a listából.</p></div>'; } document.querySelectorAll('.level button').forEach((x) => x.setAttribute('aria-checked', x === b)); syncVizsgaSelects(); render(); };
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
  function render() {
    updateTimeline();
    const L = lista();
    st.lista = L;
    const act = $('#activeTema');
    act.innerHTML = '';
    [...st.temak].forEach((k) => {
      const b = document.createElement('button');
      b.className = 'chip'; b.type = 'button'; b.textContent = temaByKod.get(k).rovid;
      b.title = 'Témakör eltávolítása';
      b.onclick = () => { st.temak.delete(k); render(); };
      act.appendChild(b);
    });
    $('#count').textContent = `${L.length} feladat`;
    const ol = $('#results');
    ol.innerHTML = '';
    if (!L.length) { ol.innerHTML = '<li class="none">Nincs a szűrésnek megfelelő feladat. Bővítsd az évek körét, vagy vegyél ki egy szűrőt.</li>'; }
    let lastGroup = null;
    const frag = document.createDocumentFragment();
    L.forEach((f) => {
      const grp = st.mod === 'vizsga' ? (f.resz === 'I' ? 'I. Rövid választ igénylő feladatok' : 'II. Esszék') : vizsgaNev(f._v);
      if (grp !== lastGroup) { const g = document.createElement('li'); g.className = 'groupname'; g.textContent = grp; frag.appendChild(g); lastGroup = grp; }
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.id = f.id;
      if (st.aktiv && st.aktiv.id === f.id) b.setAttribute('aria-current', 'true');
      const tema = temaByKod.get(f.tk);
      const meta = [];
      f.tks.forEach((k) => { const t = temaByKod.get(k); if (t) meta.push(`<span class="tag ${t.sav}">${t.rovid}</span>`); });
      meta.push(TIPUS_NEV[f.tipus] || '');
      if (f.pont) meta.push(`${f.pont} pont`);
      b.innerHTML = `<span class="r-no">${f.n}.</span><span class="r-cim">${esc(f.cim)}</span><span class="r-meta">${meta.join(' ')}</span>`;
      b.onclick = () => open(f);
      li.appendChild(b); frag.appendChild(li);
    });
    ol.appendChild(frag);
    $('#stat').textContent = `${D.feladatok.filter((f) => f._v.szint === st.szint).length} ${st.szint === 'k' ? 'középszintű' : 'emelt szintű'} feladat, ${evek[0]}–${evek[evek.length - 1]}`;
    writeUrl();
  }
  function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------- nézegető ---------- */
  const docs = new Map();
  function getDoc(url) {
    if (!docs.has(url)) {
      const task = pdfjsLib.getDocument({ url, worker: pdfWorker || undefined, disableRange: true });
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
      const ok = await buildDoc(url).catch((e) => { pagesEl.innerHTML = `<div class="empty"><p>A PDF nem tölthető be (${esc(url)}). Ellenőrizd, hogy a pdf mappa a weboldal mellett van-e.</p></div>`; console.error(e); return false; });
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
    // a másik dokumentum (feladat/útmutató) előtöltése a háttérben
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
    const tema = temaByKod.get(f.tk);
    $('#vMeta').textContent = [`${vizsgaNev(f._v)}, ${f._v.szint === 'k' ? 'középszint' : 'emelt szint'}`, TIPUS_NEV[f.tipus], f.pont ? `${f.pont} pont` : '', f.tema || (tema && tema.nev), f.hiv ? '' : 'saját besorolás'].filter(Boolean).join(' | ');
    document.querySelectorAll('.results button').forEach((b) => b.toggleAttribute('aria-current', b.dataset.id === f.id));
    document.body.classList.add('viewing');
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

  /* ---------- indulás ---------- */
  const fid = readUrl();
  buildTimeline();
  initControls();
  setMod(st.mod);
  if (fid) { const f = D.feladatok.find((x) => x.id === fid); if (f) { const d = st.doc; open(f, true); st.doc = d; } }
  if (!fid) document.body.classList.remove('viewing');
})();
