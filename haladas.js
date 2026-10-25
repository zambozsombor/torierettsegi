/* Érettségi haladás: tantárgy → szint → témakörök / évek / feladatsorok → feladatok */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const app = $('#app');
  const SUBJ = {
    mat: { nev: 'Matematika', page: 'matek.html', data: 'mat/data.js', var: 'DB_MAT', tema: 'Témakörök' },
    magy: { nev: 'Magyar nyelv és irodalom', page: 'magyar.html', data: 'magy/data.js', var: 'DB_MAGY', tema: 'Feladattípusok' },
    tori: { nev: 'Történelem', page: 'tori.html', data: 'data.js', var: 'TORI', tema: 'Témakörök' },
  };
  const HO = { 'február': 1, 'május': 2, 'május (idegen nyelvű vizsga, magyar feladatlap)': 2.5, 'május 28.': 2.1, 'május 29.': 2.2, 'október': 3 };
  const VIEWS = [['tema', null], ['ev', 'Évek'], ['vizsga', 'Feladatsorok']];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let PM = null, user = null;
  const done = {};
  const cache = {};

  /* ---------- állapot az URL-ben ---------- */
  function state() {
    const q = new URLSearchParams(location.search);
    return { t: SUBJ[q.get('t')] ? q.get('t') : null, sz: ['k', 'e'].includes(q.get('szint')) ? q.get('szint') : null,
      v: q.get('nezet') || 'tema', s: q.get('sel') || '', s2: q.get('sel2') || '' };
  }
  function go(p, replace) {
    const q = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => { if (v) q.set(k, v); });
    const u = '?' + q.toString();
    if (replace) history.replaceState(null, '', u); else history.pushState(null, '', u);
    render();
    window.scrollTo({ top: 0 });
  }
  window.addEventListener('popstate', render);

  /* ---------- adatok ---------- */
  function load(t) {
    if (cache[t]) return cache[t];
    cache[t] = new Promise((res, rej) => {
      const sc = document.createElement('script');
      sc.src = SUBJ[t].data + '?v=20261028';
      sc.onload = () => {
        const D = window[SUBJ[t].var];
        const vz = new Map(D.vizsgak.map((v) => [v.id, v]));
        const chips = t === 'magy' ? (D.tipusok || []).map((x) => ({ kod: x.kod, nev: x.nev })) : (D.temak || []).map((x) => ({ kod: x.kod, nev: x.rovid }));
        D.feladatok.forEach((f) => { f._v = vz.get(f.v); f._k = t === 'magy' ? [f.tipus] : (f.tks || []); f._key = `e:${t}:${f.id}`; });
        res({ D, chips });
      };
      sc.onerror = rej;
      document.head.appendChild(sc);
    });
    return cache[t];
  }
  const vizsgaNev = (v) => `${v.ev}. ${v.ho}`;
  const vsort = (a, b) => b.ev - a.ev || (HO[b.ho] || 0) - (HO[a.ho] || 0);

  /* ---------- megjelenítés ---------- */
  function bar(d, n) {
    const p = n ? Math.round((100 * d) / n) : 0;
    return `<div class="hbar${n && d >= n ? ' full' : ''}"><i style="width:${p}%"></i></div>`;
  }
  function card(href, title, sub, d, n) {
    return `<a class="hcard" href="${href}"><span class="hc-t">${esc(title)}</span>${sub ? `<span class="hc-s">${esc(sub)}</span>` : ''}<span class="hc-n">${d} / ${n}</span>${bar(d, n)}</a>`;
  }
  function qs(p) { const q = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => { if (v) q.set(k, v); }); return '?' + q.toString(); }
  function crumbs(items) {
    $('#crumbs').innerHTML = items.map(([href, label], i) => (i < items.length - 1 ? `<a href="${href}">${esc(label)}</a><span>›</span>` : `<b>${esc(label)}</b>`)).join('');
  }
  function cnt(list) { return list.filter((f) => done[f._key]).length; }

  async function render() {
    const st = state();
    if (!user) return;
    app.hidden = false;
    // 1. tantárgy
    if (!st.t) {
      crumbs([['?', 'Tantárgy']]);
      app.innerHTML = '<h2 class="hq">Melyik tantárgy haladását nézed?</h2><div class="hgrid big">' + Object.entries(SUBJ).map(([k, s]) => {
        const n = Object.keys(done).filter((x) => x.startsWith(`e:${k}:`)).length;
        return `<a class="hcard big" href="${qs({ t: k })}"><span class="hc-t">${s.nev}</span><span class="hc-s">${n} kipipált feladat</span></a>`;
      }).join('') + '</div>';
      return;
    }
    app.innerHTML = '<div class="muted">Betöltés…</div>';
    const { D, chips } = await load(st.t);
    if (state().t !== st.t) return;
    const S = SUBJ[st.t];
    // 2. szint
    if (!st.sz) {
      crumbs([['?', 'Tantárgy'], [qs({ t: st.t }), S.nev]]);
      app.innerHTML = '<h2 class="hq">Melyik szint?</h2><div class="hgrid big">' + [['k', 'Középszint'], ['e', 'Emelt szint']].map(([sz, nev]) => {
        const L = D.feladatok.filter((f) => f._v.szint === sz);
        return card(qs({ t: st.t, szint: sz }), nev, S.nev, cnt(L), L.length);
      }).join('') + '</div>';
      return;
    }
    // 3. nézetek
    const L = D.feladatok.filter((f) => f._v.szint === st.sz);
    const base = { t: st.t, szint: st.sz };
    const szNev = st.sz === 'k' ? 'Középszint' : 'Emelt szint';
    const cr = [['?', 'Tantárgy'], [qs({ t: st.t }), S.nev], [qs(base), szNev]];
    let html = `<div class="overall"><div><b>${cnt(L)} / ${L.length}</b> feladat kész – ${esc(S.nev)}, ${szNev.toLowerCase()}</div>${bar(cnt(L), L.length)}</div>`;
    html += '<div class="vswitch">' + VIEWS.map(([v, nev]) => `<a href="${qs({ ...base, nezet: v })}"${st.v === v ? ' aria-current="page"' : ''}>${nev || S.tema}</a>`).join('') + '</div>';
    let list = null, title = '';
    if (st.v === 'tema') {
      if (!st.s) {
        html += '<div class="hgrid">' + chips.map((c) => { const T = L.filter((f) => f._k.includes(c.kod)); return T.length ? card(qs({ ...base, nezet: 'tema', sel: c.kod }), c.nev, '', cnt(T), T.length) : ''; }).join('') + '</div>';
      } else {
        const c = chips.find((x) => x.kod === st.s) || { nev: st.s };
        cr.push([qs({ ...base, nezet: 'tema', sel: st.s }), c.nev]);
        list = L.filter((f) => f._k.includes(st.s)); title = c.nev;
      }
    } else if (st.v === 'ev') {
      if (!st.s) {
        const evek = [...new Set(L.map((f) => f._v.ev))].sort((a, b) => b - a);
        html += '<div class="hgrid">' + evek.map((e) => { const T = L.filter((f) => f._v.ev === e); return card(qs({ ...base, nezet: 'ev', sel: e }), `${e}`, 'feladatsorok', cnt(T), T.length); }).join('') + '</div>';
      } else if (!st.s2) {
        cr.push([qs({ ...base, nezet: 'ev', sel: st.s }), st.s]);
        const vk = D.vizsgak.filter((v) => v.szint === st.sz && String(v.ev) === st.s).sort(vsort);
        html += '<div class="hgrid">' + vk.map((v) => { const T = L.filter((f) => f.v === v.id); return card(qs({ ...base, nezet: 'ev', sel: st.s, sel2: v.id }), v.ho, 'feladatok', cnt(T), T.length); }).join('') + '</div>';
      } else {
        const v = D.vizsgak.find((x) => x.id === st.s2);
        cr.push([qs({ ...base, nezet: 'ev', sel: st.s }), st.s], ['', v ? v.ho : st.s2]);
        list = L.filter((f) => f.v === st.s2); title = v ? vizsgaNev(v) : '';
      }
    } else {
      if (!st.s) {
        const vk = D.vizsgak.filter((v) => v.szint === st.sz).sort(vsort);
        html += '<div class="hgrid">' + vk.map((v) => { const T = L.filter((f) => f.v === v.id); return T.length ? card(qs({ ...base, nezet: 'vizsga', sel: v.id }), vizsgaNev(v), '', cnt(T), T.length) : ''; }).join('') + '</div>';
      } else {
        const v = D.vizsgak.find((x) => x.id === st.s);
        cr.push(['', v ? vizsgaNev(v) : st.s]);
        list = L.filter((f) => f.v === st.s); title = v ? vizsgaNev(v) : '';
      }
    }
    if (list) {
      list.sort((a, b) => vsort(a._v, b._v) || a.sor - b.sor);
      const showV = st.v === 'tema';
      html += `<h2 class="hq">${esc(title)} <small>${cnt(list)} / ${list.length} kész</small></h2><ol class="hlist">` + list.map((f) => {
        const on = !!done[f._key];
        return `<li><button type="button" class="pm-check${on ? ' on' : ''}" data-key="${f._key}" aria-pressed="${on}" title="Kész / nincs kész">${on ? '✓' : ''}</button>`
          + `<a href="${S.page}?${st.sz === 'e' ? 'szint=e&' : ''}f=${encodeURIComponent(f.id)}"><span class="hl-n">${f.n}.</span><span class="hl-c">${esc(f.cim)}</span>${showV ? `<span class="hl-v">${esc(vizsgaNev(f._v))}</span>` : ''}</a></li>`;
      }).join('') + '</ol>';
    }
    crumbs(cr);
    app.innerHTML = html;
    app.querySelectorAll('.pm-check').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.key; const now = !done[k];
        if (now) done[k] = true; else delete done[k];
        PM.saveProgress(k, { status: now ? 'kesz' : '' });
        render();
      };
    });
  }
  // belső linkek: ne töltse újra az oldalt
  app.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="?"]');
    if (a) { e.preventDefault(); go(Object.fromEntries(new URLSearchParams(a.getAttribute('href').slice(1)))); }
  });
  $('#crumbs').addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="?"]');
    if (a) { e.preventDefault(); go(Object.fromEntries(new URLSearchParams(a.getAttribute('href').slice(1)))); }
  });

  /* ---------- belépés ---------- */
  function show(u) {
    user = u;
    $('#loading').hidden = true;
    if (!u) { $('#gate').hidden = false; app.hidden = true; $('#crumbs').innerHTML = ''; return; }
    $('#gate').hidden = true;
    PM.loadProgress().then((map) => {
      Object.keys(done).forEach((k) => delete done[k]);
      Object.keys(map || {}).forEach((k) => { if (k.startsWith('e:') && map[k].status === 'kesz') done[k] = true; });
      render();
    });
  }
  $('#gateLogin').onclick = () => { if (PM && PM.openLogin) PM.openLogin(); };
  (function boot() {
    PM = window.PM;
    if (!PM) { if ((boot.n = (boot.n || 0) + 1) > 60) { $('#loading').textContent = 'A fiókkezelő nem töltődött be. Frissítsd az oldalt.'; return; } setTimeout(boot, 150); return; }
    PM.onChange(show);
    PM.getUser().then(show);
  })();
})();
