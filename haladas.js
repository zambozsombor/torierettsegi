/* Érettségi haladás: tantárgy → szint → témakörök / évek / feladatsorok → feladatok */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const app = $('#app');
  const SUBJ = {
    mat: { nev: 'Matematika', page: 'matek.html', data: 'mat/data.js', var: 'DB_MAT', tema: 'Témakörök' },
    magy: { nev: 'Magyar nyelv és irodalom', page: 'magyar.html', data: 'magy/data.js', var: 'DB_MAGY', tema: 'Feladattípusok' },
    tori: { nev: 'Történelem', page: 'tori.html', data: 'data.js', var: 'TORI', tema: 'Témakörök' },
    ang: { nev: 'Angol nyelv', page: 'angol.html', data: 'ang/data.js', var: 'DB_ANG', tema: 'Vizsgarészek' },
    nem: { nev: 'Német nyelv', page: 'nemet.html', data: 'nem/data.js', var: 'DB_NEM', tema: 'Vizsgarészek' },
  };
  const TIP = (t) => t === 'magy' || t === 'ang' || t === 'nem';
  const SZO = (t, tobb) => (t === 'magy' ? (tobb ? 'feladattípusok' : 'feladattípus') : (t === 'ang' || t === 'nem') ? (tobb ? 'vizsgarészek' : 'vizsgarész') : (tobb ? 'témakörök' : 'témakör'));
  const HO = { 'február': 1, 'május': 2, 'május (idegen nyelvű vizsga, magyar feladatlap)': 2.5, 'május 28.': 2.1, 'május 29.': 2.2, 'október': 3, 'május 30.': 2.2, 'november': 3.5 };
  const VIEWS = [['tema', null], ['ev', 'Évek'], ['vizsga', 'Feladatsorok'], ['vissza', 'Visszanézés']];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let PM = null, user = null;
  const done = {};
  const rate = {};
  const cache = {};

  /* ---------- állapot az URL-ben ---------- */
  function state() {
    const q = new URLSearchParams(location.search);
    return { t: SUBJ[q.get('t')] ? q.get('t') : null, sz: ['k', 'e'].includes(q.get('szint')) ? q.get('szint') : null,
      v: q.get('nezet') || 'tema', s: q.get('sel') || '', s2: q.get('sel2') || '', ert: q.get('ert') || '12' };
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
        const chips = TIP(t) ? (D.tipusok || []).map((x) => ({ kod: x.kod, nev: x.nev })) : (D.temak || []).map((x) => ({ kod: x.kod, nev: x.rovid }));
        D.feladatok.forEach((f) => { f._v = vz.get(f.v); f._k = TIP(t) ? [f.tipus] : (f.tks || []); f._key = `e:${t}:${f.id}`; });
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
    let list = null, title = '', sortOff = false;
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
    } else if (st.v === 'vissza') {
      const R = L.filter((f) => rate[f._key]);
      const colors = PM.RATE.colors;
      const dist = (T) => { const c = {}; T.forEach((f) => { c[rate[f._key]] = (c[rate[f._key]] || 0) + 1; }); return `<div class="rv-dist">${[1, 2, 3, 4, 5].map((i) => c[i] ? `<i style="width:${c[i] / T.length * 100}%;background:${colors[i]}"></i>` : '').join('')}</div>`; };
      if (!st.s) {
        if (!R.length) {
          html += `<div class="gate"><h2>Még nincs értékelt feladatod</h2><p>A feladatbankban minden feladatnál jelöld 1–5-ig, hogy ment (1 = nagyon nehezen, 5 = nagyon jól), és itt témakörönként visszanézheted a nehezebbeket.</p><a class="linkbtn" href="${S.page}${st.sz === 'e' ? '?szint=e' : ''}">Irány a feladatbank →</a></div>`;
        } else {
          const rc = (id, nev, T) => { const hard = T.filter((f) => rate[f._key] <= 2).length; return `<a class="hcard" href="${qs({ ...base, nezet: 'vissza', sel: id })}"><span class="hc-t">${esc(nev)}</span><span class="hc-s">${T.length} értékelt · ${hard ? hard + ' nehezen ment' : 'nincs nehéz'}</span>${dist(T)}</a>`; };
          const groups = chips.map((c) => [c, R.filter((f) => f._k.includes(c.kod))]).filter(([, T]) => T.length)
            .sort((a, b) => (b[1].filter((f) => rate[f._key] <= 2).length / b[1].length) - (a[1].filter((f) => rate[f._key] <= 2).length / a[1].length));
          html += `<p class="rv-intro">Témakörönként látod, hogyan értékelted a megoldott feladatokat (${[1, 2, 3, 4, 5].map((i) => `<span class="rv-key" style="background:${colors[i]}">${i}</span>`).join('')} – 1 = nagyon nehezen, 5 = nagyon jól). Elöl a legtöbb nehézséget okozó ${SZO(st.t, true)}.</p>`;
          html += '<div class="hgrid">' + rc('*', `Összes ${SZO(st.t)}`, R) + groups.map(([c, T]) => rc(c.kod, c.nev, T)).join('') + '</div>';
        }
      } else {
        const c = chips.find((x) => x.kod === st.s);
        cr.push([qs({ ...base, nezet: 'vissza', sel: st.s }), st.s === '*' ? `Összes ${SZO(st.t)}` : (c ? c.nev : st.s)]);
        const T = st.s === '*' ? R : R.filter((f) => f._k.includes(st.s));
        const cnt5 = {}; T.forEach((f) => { cnt5[rate[f._key]] = (cnt5[rate[f._key]] || 0) + 1; });
        html += '<div class="rv-filter"><span>Mutasd ezeket:</span>' + [1, 2, 3, 4, 5].map((i) => { const on = st.ert.includes(String(i)); const nxt = on ? st.ert.replace(String(i), '') : (st.ert + i).split('').sort().join(''); return `<a class="rv-chip${on ? ' on' : ''}" style="--rc:${colors[i]}" title="${PM.RATE.labels[i]}" href="${qs({ ...base, nezet: 'vissza', sel: st.s, ert: nxt || '0' })}">${i} <small>(${cnt5[i] || 0})</small></a>`; }).join('') + '</div>';
        list = T.filter((f) => st.ert.includes(String(rate[f._key]))).sort((a, b) => (rate[a._key] - rate[b._key]) || vsort(a._v, b._v) || a.sor - b.sor);
        title = st.s === '*' ? 'Visszanézés' : (c ? c.nev : '');
        sortOff = true;
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
      if (!sortOff) list.sort((a, b) => vsort(a._v, b._v) || a.sor - b.sor);
      const showV = st.v === 'tema' || st.v === 'vissza';
      html += (st.v === 'vissza' ? `<h2 class="hq">${esc(title)} <small>${list.length} feladat</small></h2>${list.length ? '' : '<p class="muted">Ebben a szűrésben nincs feladat. Válassz más értékelést fent.</p>'}<ol class="hlist">` : `<h2 class="hq">${esc(title)} <small>${cnt(list)} / ${list.length} kész</small></h2><ol class="hlist">`) + list.map((f) => {
        return `<li><button type="button" class="pm-rate-chip" data-key="${f._key}" data-rate-anchor></button>`
          + `<a href="${S.page}?${st.sz === 'e' ? 'szint=e&' : ''}f=${encodeURIComponent(f.id)}"><span class="hl-n">${f.n}.</span><span class="hl-c">${esc(f.cim)}</span>${showV ? `<span class="hl-v">${esc(vizsgaNev(f._v))}</span>` : ''}</a></li>`;
      }).join('') + '</ol>';
    }
    crumbs(cr);
    app.innerHTML = html;
    app.querySelectorAll('.pm-rate-chip[data-key]').forEach((b) => {
      const k = b.dataset.key;
      PM.rateChip(b, done[k] ? (rate[k] || 0) : null);
      b.onclick = (e) => {
        e.stopPropagation();
        PM.ratePicker(b, done[k] ? (rate[k] || 0) : null, (n) => {
          if (n) { done[k] = true; rate[k] = n; } else { delete done[k]; delete rate[k]; }
          PM.saveRate(k, n);
          render();
        });
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
      Object.keys(done).forEach((k) => delete done[k]); Object.keys(rate).forEach((k) => delete rate[k]);
      Object.keys(map || {}).forEach((k) => { if (k.startsWith('e:') && map[k].status === 'kesz') { done[k] = true; const rr = PM.rateOf(map[k]); if (rr) rate[k] = rr; } });
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
