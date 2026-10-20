// MPG/MPP/L1 – API URL : overlay injecté par l'extension (indépendant de l'app React),
// donc toujours disponible même si l'app plante à cause d'une mauvaise API URL.
(() => {
  if (window.__mppApiUrlOverlay) return;
  window.__mppApiUrlOverlay = true;

  // Config du site (sites.js) : clé du store zustand, champs d'URL, URL par défaut.
  const site = globalThis.ApiUrlSites.detect(location.hostname);
  if (!site) return;
  const ENV = globalThis.ApiUrlSites.envOf(site, location.hostname); // historique séparé prod / dev
  const FIELDS = site.fields;
  const MULTI = FIELDS.length > 1;
  let fi = 0; // champ affiché dans le panneau (onglet actif)
  const field = () => FIELDS[fi];

  // ---------- ping <API_URL><status> ----------
  // Fetch normal (l'API autorise le CORS depuis le site). Si le CORS bloque,
  // on retente en no-cors : une réponse opaque prouve au moins que le serveur répond.
  const statusUrl = (base, f) => base.replace(/\/+$/, '') + f.status;
  async function ping(base, f) {
    const url = statusUrl(base, f);
    const t0 = performance.now();
    const ms = () => Math.round(performance.now() - t0) + ' ms';
    try {
      const r = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000) });
      return r.ok
        ? { level: 'ok', text: `Dispo (HTTP ${r.status}, ${ms()})` }
        : { level: 'warn', text: `Répond mais HTTP ${r.status} (${ms()})` };
    } catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError') return { level: 'ko', text: 'Pas de réponse (timeout 5 s)' };
      try {
        await fetch(url, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000) });
        return { level: 'warn', text: `Répond, mais CORS bloqué : statut inconnu (${ms()})` };
      } catch {
        return { level: 'ko', text: 'Injoignable' };
      }
    }
  }

  // ---------- lecture / écriture du store ----------
  function readStore() {
    try {
      const raw = localStorage.getItem(site.key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function getUrl(f = field()) {
    return readStore()?.state?.data?.[f.id] || '';
  }
  // changes : { [fieldId]: url | '' } — '' supprime l'URL custom du champ.
  function writeUrls(changes) {
    const o = readStore() || { state: { _hasHydrated: true, data: {} }, version: site.version };
    o.state = o.state || {};
    o.state.data = o.state.data || {};
    for (const [id, url] of Object.entries(changes)) {
      if (url) o.state.data[id] = url;
      else delete o.state.data[id];
    }
    localStorage.setItem(site.key, JSON.stringify(o));
  }
  function normalize(v) {
    v = (v || '').trim();
    if (!v) return '';
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  }
  const host = (u) => u.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

  // ---------- historique (history.js : storage.sync + storage.local), un par champ et par env ----------
  // Entrées : { url, pinned }. Les épinglées restent en tête et ne sont jamais
  // évincées par la limite ni par "Clear all".
  const H = globalThis.ApiUrlHistory;
  const histId = (f = field()) => globalThis.ApiUrlSites.historyId(site, f, ENV);
  const getHistory = () => H.get(histId());
  const pushHistory = (url, id = histId()) => H.push(id, url);
  const removeHistory = (url) => H.remove(histId(), url);
  const togglePin = (url) => H.togglePin(histId(), url);
  const clearHistory = () => H.clear(histId());

  // Si l'URL n'a pas pu être enregistrée (extension rechargée → contexte invalidé),
  // on la garde dans le localStorage du site et le prochain content script la reprend.
  const PENDING_KEY = 'apiUrlHistoryPending';
  function flushPending() {
    let p; try { p = localStorage.getItem(PENDING_KEY); } catch { return; }
    if (!p || !H.alive()) return;
    let id = globalThis.ApiUrlSites.historyId(site, FIELDS[0], ENV), url = p;
    try { const o = JSON.parse(p); if (o?.url) ({ id, url } = o); } catch {}
    pushHistory(url, id).then((ok) => { if (ok) try { localStorage.removeItem(PENDING_KEY); } catch {} });
  }
  flushPending();

  // ---------- UI (shadow DOM, attaché à <html> pour survivre au crash/re-render de l'app) ----------
  const hostEl = document.createElement('mpp-api-url-overlay');
  hostEl.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:12px;bottom:12px;';
  const root = hostEl.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
      * { box-sizing: border-box; }
      .pill { display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none;
        padding:6px 10px; border-radius:999px; border:none; color:#fff; font:600 12px system-ui;
        background:#2b2f36; box-shadow:0 2px 8px rgba(0,0,0,.3); opacity:.55; transition:opacity .15s; }
      .pill:hover, .pill.custom { opacity:1; }
      .pill.custom { background:#e63946; transform-origin:center; animation:heartbeat 1.4s ease-in-out infinite; }
      .pill.custom:hover { animation-play-state:paused; }
      /* Battement de cœur : double pulsation "lub-dub" + halo qui s'étend */
      @keyframes heartbeat {
        0%   { transform:scale(1);    box-shadow:0 2px 8px rgba(0,0,0,.3), 0 0 0 0 rgba(230,57,70,.3); }
        14%  { transform:scale(1.03); }
        28%  { transform:scale(1); }
        42%  { transform:scale(1.03); box-shadow:0 2px 8px rgba(0,0,0,.3), 0 0 0 3px rgba(230,57,70,.12); }
        70%  { transform:scale(1);    box-shadow:0 2px 8px rgba(0,0,0,.3), 0 0 0 5px rgba(230,57,70,0); }
        100% { transform:scale(1);    box-shadow:0 2px 8px rgba(0,0,0,.3), 0 0 0 0 rgba(230,57,70,0); }
      }
      @media (prefers-reduced-motion: reduce) { .pill.custom { animation:none; } }
      /* URL utilisée, en retrait à droite du label */
      .pill .pu { font:500 11px ui-monospace, SFMono-Regular, Menlo, monospace; color:#a9b0bb;
        background:rgba(0,0,0,.28); padding:2px 7px; border-radius:999px; margin-right:-4px;
        max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .pill.custom .pu { color:#ffe1e3; background:rgba(0,0,0,.25); }
      .pill .dot { width:8px; height:8px; border-radius:50%; background:#7bd389; }
      .pill.custom .dot { background:#fff; }
      .panel { display:none; position:absolute; left:0; bottom:40px; width:360px; max-width:calc(100vw - 24px);
        background:#1e2127; color:#e8e8e8; border-radius:10px; padding:12px; box-shadow:0 8px 24px rgba(0,0,0,.45); }
      .panel.open { display:block; }
      .title { font-weight:700; margin-bottom:8px; display:flex; justify-content:space-between; }
      .x { cursor:pointer; opacity:.6; background:none; border:none; color:inherit; font-size:16px; line-height:1; }
      .tabs { display:flex; gap:4px; margin-bottom:8px; }
      .tabs[hidden] { display:none; }
      .tab { flex:1; position:relative; padding:5px 6px; border-radius:6px; border:1px solid #3a3f48; background:#2b2f36;
        color:#c9ced6; cursor:pointer; font:600 11px system-ui; }
      .tab:hover { color:#fff; }
      .tab.on { background:#3a86ff; border-color:#3a86ff; color:#fff; }
      .tab.custom::after { content:''; position:absolute; top:4px; right:5px; width:6px; height:6px; border-radius:50%;
        background:#e63946; box-shadow:0 0 0 1.5px #1e2127; }
      .cur { font-size:11px; margin-bottom:8px; word-break:break-all; opacity:.85; }
      .cur b { color:#ffb4b4; }
      input { width:100%; padding:7px 8px; border-radius:6px; border:1px solid #444; background:#111; color:#fff; font:12px ui-monospace, monospace; }
      .row { display:flex; gap:8px; margin-top:8px; }
      button.b { flex:1; padding:7px; border-radius:6px; border:none; cursor:pointer; font:600 12px system-ui; }
      .apply { background:#3a86ff; color:#fff; }
      .reset { background:#e63946; color:#fff; }
      .hint { font-size:10px; opacity:.5; margin-top:8px; }
      .st { display:flex; align-items:center; gap:6px; font-size:11px; margin:-2px 0 8px; min-height:16px; }
      .st.inp { margin:6px 0 0; }
      .st .d { width:8px; height:8px; border-radius:50%; background:#777; flex:none; }
      .st.ok .d { background:#7bd389; } .st.ok .t { color:#9be3a6; }
      .st.warn .d { background:#ffd166; } .st.warn .t { color:#ffd98a; }
      .st.ko .d { background:#e63946; } .st.ko .t { color:#ff9a9a; }
      .st.wait .d { animation:blink .8s infinite alternate; }
      @keyframes blink { to { opacity:.2; } }
      .st .t { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .st[hidden] { display:none; }
      .histbox { margin-top:8px; }
      .histhead { display:flex; justify-content:space-between; align-items:center; font-size:11px; opacity:.7; margin-bottom:4px; }
      .clear { background:none; border:none; color:#ff8a8a; cursor:pointer; font:600 11px system-ui; padding:0; }
      .clear:hover { text-decoration:underline; }
      .hist { display:flex; flex-direction:column; gap:3px; max-height:200px; overflow:auto; }
      .item { display:flex; align-items:center; gap:4px; background:#2b2f36; border-radius:4px; padding:2px 4px; }
      .item.pinned { background:#2f3540; box-shadow:inset 2px 0 0 #ffd166; }
      .item .hd { width:8px; height:8px; border-radius:50%; background:#777; flex:none; margin:0 2px; }
      .item .hd.wait { animation:blink .8s infinite alternate; }
      .item .hd.ok { background:#7bd389; } .item .hd.warn { background:#ffd166; } .item .hd.ko { background:#e63946; }
      .item .ms { font:10px ui-monospace, monospace; opacity:.55; flex:none; }
      .item .u { flex:1; min-width:0; font:11px ui-monospace, monospace; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:2px; }
      .item .u:hover { color:#fff; text-decoration:underline; }
      .item .u.active { color:#ffb4b4; }
      .ic { background:none; border:none; cursor:pointer; color:#aaa; width:20px; height:20px; padding:0; display:grid; place-items:center; border-radius:3px; flex:none; }
      .ic:hover { background:#3a3f48; color:#fff; }
      .ic.pin.on { color:#ffd166; }
      .ic svg { width:13px; height:13px; }
      .empty { font-size:11px; opacity:.45; }
    </style>
    <button class="pill" part="pill"><span class="dot"></span><span class="lbl">API</span><span class="pu"></span></button>
    <div class="panel">
      <div class="title"><span class="ttl">API URL</span> <button class="x" title="Fermer">×</button></div>
      <div class="tabs" hidden></div>
      <div class="cur"></div>
      <div class="st cur-st"><span class="d"></span><span class="t"></span><button class="ic re" title="Re-tester (URL courante + historique)">↻</button></div>
      <input type="text" placeholder="https://api-xxx..." spellcheck="false" autocomplete="off">
      <div class="st inp inp-st" hidden><span class="d"></span><span class="t"></span></div>
      <div class="histbox">
        <div class="histhead"><span class="hh">Historique</span><button class="clear" title="Supprime toutes les entrées non épinglées">Clear all</button></div>
        <div class="hist"></div>
      </div>
      <div class="row">
        <button class="b apply">Appliquer</button>
        <button class="b reset">Reset</button>
      </div>
      <div class="hint"></div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  $('.ttl').textContent = site.title + ' – API URL' + (MULTI ? 's' : '');
  $('.hint').textContent = MULTI
    ? 'Alt+Shift+U : ouvrir/fermer · Alt+Shift+R : reset de toutes les URL'
    : 'Alt+Shift+U : ouvrir/fermer · Alt+Shift+R : reset immédiat';
  const pill = $('.pill'), lbl = $('.lbl'), panel = $('.panel'), input = $('input'), cur = $('.cur'), hist = $('.hist'), clearBtn = $('.clear');
  const tabs = $('.tabs'), resetBtn = $('.reset');
  if (ENV === 'dev') $('.hh').textContent = 'Historique (dev)';
  clearBtn.addEventListener('click', async () => { await clearHistory(); renderHistory(); });

  // Onglets (sites à plusieurs URL : L1 / FL1 / Fanbase).
  const tabBtns = FIELDS.map((f, i) => {
    const b = document.createElement('button');
    b.className = 'tab'; b.textContent = f.label;
    b.addEventListener('click', () => selectField(i));
    return b;
  });
  if (MULTI) { tabs.replaceChildren(...tabBtns); tabs.hidden = false; }

  function render() {
    const customs = FIELDS.filter((f) => getUrl(f));
    pill.classList.toggle('custom', customs.length > 0);
    lbl.textContent = customs.length ? 'API custom' : 'API';
    // URL réellement utilisée (custom ou défaut), sans le protocole ni le slash final.
    // Plusieurs champs : seules les URL custom sont listées (sinon l'URL par défaut du 1er champ).
    pill.querySelector('.pu').textContent = !MULTI
      ? host(getUrl(FIELDS[0]) || FIELDS[0].def)
      : customs.length
        ? customs.map((f) => f.label + ' ' + host(getUrl(f))).join(' · ')
        : host(FIELDS[0].def);
    pill.title = FIELDS.map((f) => (MULTI ? f.label + ' : ' : 'API URL ') + (getUrl(f) ? 'custom ' + getUrl(f) : 'par défaut')).join('\n');

    tabBtns.forEach((b, i) => {
      b.classList.toggle('on', i === fi);
      b.classList.toggle('custom', !!getUrl(FIELDS[i]));
      b.title = FIELDS[i].label + ' : ' + (getUrl(FIELDS[i]) || 'défaut (' + FIELDS[i].def + ')');
    });
    const url = getUrl();
    const name = MULTI ? field().label + ' – ' : '';
    cur.innerHTML = url ? '<span></span><b></b>' : '<span></span>';
    cur.firstChild.textContent = name + (url ? 'Actuelle : ' : 'Actuelle : défaut (aucune URL custom)');
    if (url) cur.querySelector('b').textContent = url;
    resetBtn.textContent = MULTI ? 'Reset ' + field().label : 'Reset';
  }
  const PIN_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 3l5 5-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z"/></svg>';
  const DEL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  function iconBtn(cls, svg, title, onClick) {
    const b = document.createElement('button');
    b.className = 'ic ' + cls; b.innerHTML = svg; b.title = title;
    b.addEventListener('click', async (e) => { e.stopPropagation(); await onClick(); renderHistory(); });
    return b;
  }
  // Ping des entrées de l'historique : un ping par URL à chaque ouverture du menu,
  // résultat mis en cache pour ne pas re-pinger à chaque re-render (pin / suppression).
  const histPings = new Map(); // statusUrl -> Promise<{level,text}>
  function pingHistoryItem(url, dot, ms) {
    const f = field(), k = statusUrl(url, f);
    if (!histPings.has(k)) histPings.set(k, ping(url, f));
    dot.className = 'hd wait'; dot.title = 'Ping en cours…';
    histPings.get(k).then((r) => {
      if (!dot.isConnected) return;
      dot.className = 'hd ' + r.level;
      dot.title = r.text;
      const m = r.text.match(/(\d+ ms)/);
      ms.textContent = r.level === 'ko' ? (/timeout/.test(r.text) ? 'timeout' : 'KO') : (m ? m[1] : '');
      ms.title = r.text;
    });
  }
  let histSeq = 0;
  async function renderHistory() {
    const n = ++histSeq;
    const h = await getHistory();
    if (n !== histSeq) return; // onglet changé entre-temps
    const current = getUrl();
    clearBtn.style.visibility = h.some((e) => !e.pinned) ? 'visible' : 'hidden';
    if (!H.alive()) {
      const d = document.createElement('div');
      d.className = 'empty';
      d.textContent = 'Extension mise à jour : recharge la page pour retrouver l\'historique.';
      return hist.replaceChildren(d);
    }
    if (!h.length) {
      const d = document.createElement('div');
      d.className = 'empty'; d.textContent = 'Aucune URL utilisée pour le moment';
      return hist.replaceChildren(d);
    }
    hist.replaceChildren(...h.map(({ url, pinned }) => {
      const row = document.createElement('div');
      row.className = 'item' + (pinned ? ' pinned' : '');
      const u = document.createElement('span');
      u.className = 'u' + (url === current ? ' active' : '');
      u.textContent = url; u.title = 'Remplir avec ' + url + ' (double-clic : appliquer)';
      u.onclick = () => { input.value = url; input.focus(); pingInput(); };
      u.ondblclick = () => { input.value = url; apply(); };
      const dot = document.createElement('span');
      const ms = document.createElement('span'); ms.className = 'ms';
      pingHistoryItem(url, dot, ms);
      row.append(
        iconBtn('pin' + (pinned ? ' on' : ''), PIN_SVG, pinned ? 'Désépingler' : 'Épingler', () => togglePin(url)),
        dot,
        u,
        ms,
        iconBtn('del', DEL_SVG, 'Supprimer de l\'historique', () => removeHistory(url)),
      );
      return row;
    }));
  }
  // Affiche le résultat d'un ping dans une ligne .st (ignore les réponses obsolètes).
  const seq = new WeakMap();
  async function showPing(el, base, prefix = '') {
    const n = (seq.get(el) || 0) + 1; seq.set(el, n);
    const f = field();
    el.hidden = false;
    el.className = el.className.replace(/\b(ok|warn|ko|wait)\b/g, '').trim() + ' wait';
    el.querySelector('.t').textContent = prefix + 'Ping en cours…';
    const r = await ping(base, f);
    if (seq.get(el) !== n) return;
    el.className = el.className.replace(/\bwait\b/, '').trim() + ' ' + r.level;
    const t = el.querySelector('.t');
    t.textContent = prefix + r.text;
    t.title = statusUrl(base, f);
  }
  const curSt = $('.cur-st'), inpSt = $('.inp-st');
  const pingCurrent = () => showPing(curSt, getUrl() || field().def, getUrl() ? '' : 'Défaut : ');
  // ↻ : re-teste l'URL courante ET tout l'historique.
  $('.re').addEventListener('click', () => { histPings.clear(); pingCurrent(); renderHistory(); });

  // Ping de l'URL saisie (debounce) pour vérifier avant d'appliquer.
  let inpTimer;
  function pingInput() {
    clearTimeout(inpTimer);
    const v = normalize(input.value);
    let valid = false; try { new URL(v); valid = !!v; } catch {}
    if (!valid || v === (getUrl() || field().def)) { seq.set(inpSt, (seq.get(inpSt) || 0) + 1); inpSt.hidden = true; return; }
    inpTimer = setTimeout(() => showPing(inpSt, v, 'URL saisie : '), 500);
  }
  input.addEventListener('input', pingInput);

  // Affiche un champ dans le panneau (onglet).
  function selectField(i) {
    fi = i;
    clearTimeout(inpTimer);
    input.value = getUrl(); input.style.borderColor = ''; inpSt.hidden = true;
    input.placeholder = field().def;
    render(); renderHistory(); pingCurrent();
    setTimeout(() => input.focus(), 0);
  }
  function toggle(open = !panel.classList.contains('open')) {
    panel.classList.toggle('open', open);
    if (open) {
      histPings.clear();
      // Onglet par défaut : le premier champ qui a une URL custom.
      const i = FIELDS.findIndex((f) => getUrl(f));
      selectField(i < 0 ? 0 : i);
    }
  }
  async function apply() {
    const url = normalize(input.value);
    if (!url) return reset();
    try { new URL(url); } catch { input.style.borderColor = '#e63946'; return; }
    const id = histId();
    writeUrls({ [field().id]: url });
    if (!(await pushHistory(url, id).catch(() => false))) {
      try { localStorage.setItem(PENDING_KEY, JSON.stringify({ id, url })); } catch {}
    }
    location.reload();
  }
  // Reset du champ affiché (ou de tous les champs).
  function reset(all = false) {
    writeUrls(Object.fromEntries((all ? FIELDS : [field()]).map((f) => [f.id, ''])));
    location.reload();
  }

  pill.addEventListener('click', () => toggle());
  $('.x').addEventListener('click', () => toggle(false));
  $('.apply').addEventListener('click', apply);
  resetBtn.addEventListener('click', () => reset());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // évite que l'app intercepte la saisie
    if (e.key === 'Enter') apply();
    if (e.key === 'Escape') toggle(false);
  });
  ['keyup', 'keypress', 'input'].forEach((t) => input.addEventListener(t, (e) => e.stopPropagation()));

  // Fermeture : Échap n'importe où, ou clic en dehors de l'overlay.
  const isOpen = () => panel.classList.contains('open');
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) { e.preventDefault(); e.stopPropagation(); toggle(false); }
  }, true);
  window.addEventListener('pointerdown', (e) => {
    if (isOpen() && !e.composedPath().includes(hostEl)) toggle(false);
  }, true);

  window.addEventListener('keydown', (e) => {
    if (!e.altKey || !e.shiftKey) return;
    if (e.code === 'KeyU') { e.preventDefault(); toggle(); }
    if (e.code === 'KeyR') { e.preventDefault(); reset(true); }
  }, true);

  // Resynchro si un autre onglet (ou la page debug du site) modifie le store.
  window.addEventListener('storage', (e) => { if (e.key === site.key) render(); });
  // Historique modifié ailleurs (autre onglet, popup, autre poste via la synchro).
  try {
    chrome.storage.onChanged.addListener((changes) => {
      if (H.key(histId()) in changes && isOpen()) renderHistory();
    });
  } catch {}

  // Attache à <html> (pas <body>) et ré-attache si l'app l'enlève.
  function mount() {
    const parent = document.documentElement;
    if (parent && !hostEl.isConnected) parent.appendChild(hostEl);
  }
  mount();
  render();
  new MutationObserver(mount).observe(document, { childList: true, subtree: false });
  document.addEventListener('DOMContentLoaded', mount);
  setInterval(mount, 2000);
})();
