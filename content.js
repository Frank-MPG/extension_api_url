// MPG / MPP / L1 – Changer d'API : overlay injecté par l'extension (indépendant de l'app React),
// donc toujours disponible même si l'app plante à cause d'une mauvaise API URL.
(() => {
  if (window.__mppApiUrlOverlay) return;
  window.__mppApiUrlOverlay = true;

  // Config du site (sites.js) : clé du store zustand, champs d'URL, URL par défaut.
  const site = globalThis.ApiUrlSites.detect(location.hostname);
  if (!site) return;
  const ENV = globalThis.ApiUrlSites.envOf(site, location.hostname); // historique séparé prod / dev
  const FIELDS = globalThis.ApiUrlSites.fieldsFor(site, ENV); // URL par défaut selon prod / dev
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
      * { box-sizing:border-box; }
      [hidden] { display:none !important; }
      /* L'hôte est en all:initial (isolé du CSS du site), qui écrase :host : la police se pose ici. */
      .pill, .panel { font-family:system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing:antialiased; }
      button, input { font-family:inherit; }
      .pill { display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none;
        padding:8px 14px; border-radius:999px; border:none; color:#fff; font-size:14px; font-weight:600;
        background:#2b2f36; box-shadow:0 2px 10px rgba(0,0,0,.35); opacity:.6; transition:opacity .15s; }
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
      @media (prefers-reduced-motion: reduce) { .pill.custom { animation:none; } .tt { transition:none; } }
      /* URL utilisée, en retrait à droite du label */
      .pill .pu { font:500 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; color:#b7bec9;
        background:rgba(0,0,0,.28); padding:3px 9px; border-radius:999px; margin-right:-6px;
        max-width:520px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .pill.custom .pu { color:#ffe1e3; background:rgba(0,0,0,.25); }
      .pill .dot { width:9px; height:9px; border-radius:50%; background:#7bd389; }
      .pill.custom .dot { background:#fff; }

      .panel { display:none; position:absolute; left:0; bottom:48px; width:440px; max-width:calc(100vw - 24px);
        max-height:calc(100vh - 72px); overflow:auto; overscroll-behavior:contain;
        background:#1b1e24; color:#e9ecf1; font-size:14px; line-height:1.4; border:1px solid #2c313a;
        border-radius:14px; padding:16px; box-shadow:0 16px 40px rgba(0,0,0,.5); }
      .panel.open { display:flex; flex-direction:column; gap:16px; }
      .title { display:flex; align-items:center; gap:8px; }
      .ttl { flex:1; font-size:17px; font-weight:700; }
      .env { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; padding:3px 8px;
        border-radius:999px; background:rgba(255,209,102,.15); color:#ffd166; }
      .x { cursor:pointer; background:none; border:none; color:#9aa3b2; font-size:22px; line-height:1; width:32px; height:32px; border-radius:8px; }
      .x:hover { background:#2c313a; color:#fff; }
      .tabs { display:flex; gap:6px; }
      .tab { flex:1; position:relative; padding:8px; border-radius:8px; border:1px solid #343a45; background:#252932;
        color:#c9ced6; cursor:pointer; font-size:13px; font-weight:600; }
      .tab:hover { color:#fff; border-color:#4a5160; }
      .tab.on { background:#3a86ff; border-color:#3a86ff; color:#fff; }
      .tab.custom::after { content:''; position:absolute; top:5px; right:6px; width:7px; height:7px; border-radius:50%;
        background:#e63946; box-shadow:0 0 0 2px #1b1e24; }

      /* En-têtes de section */
      .sh { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; min-height:26px;
        font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:#8a93a3; }
      .sh small { font-size:12px; font-weight:500; text-transform:none; letter-spacing:0; }

      /* API actuelle */
      .now { background:#232730; border:1px solid #2f3540; border-radius:10px; padding:10px 12px 12px; }
      .now.custom { border-color:rgba(230,57,70,.55); background:rgba(230,57,70,.08); }
      .now .sh { margin-bottom:4px; }
      .cur { font:500 14px ui-monospace, SFMono-Regular, Menlo, monospace; word-break:break-all; }
      .now.custom .cur { color:#ffb4b4; }
      .st { display:flex; align-items:center; gap:8px; font-size:13px; margin-top:8px; min-height:20px; }
      .st .d { width:9px; height:9px; border-radius:50%; background:#777; flex:none; }
      .st.ok .d { background:#7bd389; } .st.ok .t { color:#9be3a6; }
      .st.warn .d { background:#ffd166; } .st.warn .t { color:#ffd98a; }
      .st.ko .d { background:#e63946; } .st.ko .t { color:#ff9a9a; }
      .st.wait .d { animation:blink .8s infinite alternate; }
      @keyframes blink { to { opacity:.2; } }
      .st .t { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

      /* Time-traveler : bloc mis en avant */
      .ttbox { border-radius:12px; padding:10px 12px 12px; border:1px solid rgba(124,92,255,.5);
        background:linear-gradient(135deg, rgba(124,92,255,.24), rgba(124,92,255,.06)); }
      .ttbox .sh { color:#c9bcff; }
      .ttbox .sh small { color:#a596e6; }
      .ttlist { display:flex; flex-direction:column; gap:6px; }
      .tt { display:flex; align-items:center; gap:10px; text-align:left; padding:10px 12px; border-radius:10px;
        cursor:pointer; border:1px solid rgba(124,92,255,.45); background:rgba(17,19,25,.6); color:#e9ecf1;
        transition:transform .1s, background .15s, border-color .15s; }
      .tt:hover { border-color:#a48bff; background:rgba(124,92,255,.22); transform:translateY(-1px); }
      .tt.active { background:#7c5cff; border-color:#a48bff; box-shadow:0 0 0 3px rgba(124,92,255,.3); color:#fff; }
      .tt.busy { opacity:.55; }
      .tt .l1 { flex:1; min-width:0; display:flex; align-items:center; gap:6px; font-size:15px; font-weight:700; }
      .tt .l1 b { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .tt .id { flex:none; font:600 11.5px ui-monospace, SFMono-Regular, Menlo, monospace; padding:1px 7px; border-radius:999px;
        background:rgba(255,255,255,.1); color:#d6ccff; }
      .tt.active .id { background:rgba(255,255,255,.22); color:#fff; }
      .tt .l2 { flex:none; font-size:13px; color:#a9b0c0; white-space:pre; }
      .tt.active .l2 { color:#efeaff; }
      .tt .on { flex:none; font-size:14px; }

      /* Saisie */
      input { width:100%; padding:10px 12px; border-radius:8px; border:1px solid #3a404c; background:#12141a; color:#fff;
        font:14px ui-monospace, SFMono-Regular, Menlo, monospace; outline:none; }
      input:focus { border-color:#3a86ff; box-shadow:0 0 0 3px rgba(58,134,255,.25); }
      .row { display:flex; gap:8px; margin-top:10px; }
      button.b { flex:1; padding:10px; border-radius:8px; cursor:pointer; font-size:14px; font-weight:600; border:1px solid transparent; }
      .apply { background:#3a86ff; color:#fff; }
      .apply:hover { background:#2f76e8; }
      .reset { background:rgba(230,57,70,.12); border-color:rgba(230,57,70,.7); color:#ff9a9a; }
      .reset:hover { background:#e63946; border-color:#e63946; color:#fff; }

      /* Historique */
      .clear { background:none; border:none; color:#ff8a8a; cursor:pointer; font-size:12px; font-weight:600; padding:0; text-transform:none; letter-spacing:0; }
      .clear:hover { text-decoration:underline; }
      .hist { display:flex; flex-direction:column; gap:4px; max-height:240px; overflow:auto; }
      .item { display:flex; align-items:center; gap:6px; background:#232730; border:1px solid #2c313a; border-radius:8px; padding:3px 6px; }
      .item:hover { border-color:#3a404c; }
      .item.pinned { box-shadow:inset 3px 0 0 #ffd166; }
      .item .hd { width:9px; height:9px; border-radius:50%; background:#777; flex:none; margin:0 2px; }
      .item .hd.wait { animation:blink .8s infinite alternate; }
      .item .hd.ok { background:#7bd389; } .item .hd.warn { background:#ffd166; } .item .hd.ko { background:#e63946; }
      .item .ms { font:11.5px ui-monospace, SFMono-Regular, Menlo, monospace; color:#8a93a3; flex:none; }
      .item .u { flex:1; min-width:0; font:13px ui-monospace, SFMono-Regular, Menlo, monospace; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:3px 2px; }
      .item .u:hover { color:#fff; text-decoration:underline; }
      .item .u.active { color:#ffb4b4; }
      .ic { background:none; border:none; cursor:pointer; color:#8a93a3; width:26px; height:26px; padding:0; display:grid; place-items:center; border-radius:6px; flex:none; font-size:16px; }
      .ic:hover { background:#343a45; color:#fff; }
      .ic.pin.on { color:#ffd166; }
      .ic svg { width:15px; height:15px; }
      .empty { font-size:13px; color:#8a93a3; }
      .hint { font-size:12px; color:#7d8696; border-top:1px solid #2c313a; padding-top:12px; }
      kbd { font:600 11px ui-monospace, SFMono-Regular, Menlo, monospace; padding:1px 5px; border-radius:4px;
        background:#2c313a; border:1px solid #3a404c; color:#c9ced6; }
    </style>
    <button class="pill" part="pill"><span class="dot"></span><span class="lbl">API</span><span class="pu"></span></button>
    <div class="panel">
      <div class="title"><span class="ttl">API URL</span><span class="env" hidden title="Historique séparé de la prod">dev</span><button class="x" title="Fermer (Échap)">×</button></div>
      <div class="tabs" hidden></div>
      <div class="now">
        <div class="sh"><span class="lab">API</span><button class="ic re" title="Re-tester (URL courante + historique)">↻</button></div>
        <div class="cur"></div>
        <div class="st cur-st"><span class="d"></span><span class="t"></span></div>
      </div>
      <div class="ttbox" hidden>
        <div class="sh"><span>Time-traveler</span><small>clic = API de l'instance, hors historique</small></div>
        <div class="ttlist"></div>
      </div>
      <div>
        <div class="sh">URL custom</div>
        <input type="text" placeholder="https://api-xxx..." spellcheck="false" autocomplete="off">
        <div class="st inp inp-st" hidden><span class="d"></span><span class="t"></span></div>
        <div class="row"><button class="b apply">Appliquer</button><button class="b reset">Reset</button></div>
      </div>
      <div>
        <div class="sh"><span>Historique</span><button class="clear" title="Supprime toutes les entrées non épinglées">Clear all</button></div>
        <div class="hist"></div>
      </div>
      <div class="hint"></div>
    </div>`;

  const $ = (s) => root.querySelector(s);
  $('.ttl').textContent = site.title + ' – API URL' + (MULTI ? 's' : '');
  const kbd = (keys) => keys.split('+').map((k) => '<kbd>' + k + '</kbd>').join(' + ');
  $('.hint').innerHTML = kbd('Alt+Shift+U') + ' ouvrir / fermer · ' + kbd('Alt+Shift+R') + (MULTI ? ' reset de toutes les URL' : ' reset immédiat');
  const pill = $('.pill'), lbl = $('.lbl'), panel = $('.panel'), input = $('input'), cur = $('.cur'), hist = $('.hist'), clearBtn = $('.clear');
  const tabs = $('.tabs'), resetBtn = $('.reset'), now = $('.now');
  $('.env').hidden = ENV !== 'dev';
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
    // Connecté à une instance Time-traveler : son nom, son heure et son expiration plutôt que l'URL.
    const tt = pillInstance();
    lbl.textContent = tt ? 'Time-traveler' : customs.length ? 'API custom' : 'API';
    // URL réellement utilisée (custom ou défaut), sans le protocole ni le slash final.
    // Plusieurs champs : seules les URL custom sont listées (sinon l'URL par défaut du 1er champ).
    pill.querySelector('.pu').textContent = tt
      ? ttPillText(tt)
      : !MULTI
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
    $('.lab').textContent = (MULTI ? field().label + ' · ' : '') + (url ? 'API custom' : 'API par défaut');
    cur.textContent = url || field().def;
    now.classList.toggle('custom', !!url);
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
  const pingCurrent = () => showPing(curSt, getUrl() || field().def);
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

  // ---------- Time-traveler : un bouton par instance → applique son API (links[field().tt]) ----------
  // Token en lecture seule (scope « instances »), volontairement en dur : il n'est pas sensible.
  const TT_API = 'https://time-traveler.mpg.football/api/instances';
  const TT_TOKEN = 'eyJzY29wZSI6Imluc3RhbmNlcyIsImFwcCI6ImV4dGVuc2lvbl9jaHJvbWUiLCJpYXQiOiIyMDI2LTExLTE3VDE1OjE1OjE4Ljg4NVoifQ.omoiUOSsKohU8CLpNuU12wkPeue94X6hsASYhcq-Mj8';
  const ttBox = $('.ttbox'), ttList = $('.ttlist');
  let ttReq = null; // une requête par ouverture du panneau
  const fetchInstances = () => fetch(TT_API, {
    headers: { Authorization: 'Bearer ' + TT_TOKEN }, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000),
  }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then((j) => j.instances || []);
  const fmt = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  function expiry(i) {
    if (i.lifetime?.keep || !i.lifetime?.expiresAt) return 'sans expiration';
    const d = new Date(i.lifetime.expiresAt), now = new Date();
    if (d <= now) return 'expirée';
    const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? 'expire à ' + hm
      : 'expire le ' + d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' à ' + hm;
  }
  // Pastille : instance de l'URL courante. Un appel au chargement, seulement si l'URL est sur Time-traveler.
  let pillTT = null;
  const pillInstance = () => (!MULTI && pillTT?.links?.[FIELDS[0].tt] === getUrl(FIELDS[0]) ? pillTT : null);
  // Heure dans l'instance = horloge locale + écart mesuré au chargement (l'horloge simulée avance en temps réel).
  const ttPillText = (i) => [i.label || i.instance, Number.isFinite(i.skew) && '🕰 ' + fmt(Date.now() + i.skew), expiry(i)]
    .filter(Boolean).join(' · ');
  async function loadPillTT() {
    const f = FIELDS[0], url = getUrl(f);
    let h = ''; try { h = new URL(url).hostname; } catch {}
    if (MULTI || !f.tt || !h.endsWith('.' + new URL(TT_API).hostname)) return;
    try { pillTT = (await fetchInstances()).find((i) => i.links?.[f.tt] === url) || null; } catch { return; }
    if (!pillTT) return;
    pillTT.skew = Date.parse(pillTT.clock?.now) - Date.now();
    render();
    // Seule la pastille est rafraîchie (render() réécrirait aussi le panneau et casserait une sélection en cours).
    setInterval(() => { const tt = pillInstance(); if (tt) pill.querySelector('.pu').textContent = ttPillText(tt); }, 10000);
  }
  const el = (tag, className, textContent = '') => Object.assign(document.createElement(tag), { className, textContent });
  const line = (text) => el('div', 'empty', text);
  async function renderTT() {
    const f = field();
    ttBox.hidden = !f.tt;
    if (!f.tt) return;
    if (!ttReq) { ttReq = fetchInstances(); ttList.replaceChildren(line('Chargement…')); }
    let list;
    try { list = (await ttReq).filter((i) => i.links?.[f.tt]); } catch (e) {
      ttReq = null; // nouvel essai à la prochaine ouverture
      if (field() === f) ttList.replaceChildren(line('Time-traveler injoignable (' + (e.message || e.name) + ')'));
      return;
    }
    if (field() !== f) return; // onglet changé entre-temps
    if (!list.length) return ttList.replaceChildren(line('Aucune instance'));
    const current = getUrl();
    ttList.replaceChildren(...list.map((i) => {
      const url = i.links[f.tt];
      const ready = !i.busy && (!i.lastJob || i.lastJob.status === 'ready');
      const active = url === current;
      const ver = (k) => i.version?.[k] && k + ' ' + i.version[k].ref + '@' + i.version[k].sha;
      const b = el('button', 'tt' + (active ? ' active' : '') + (ready ? '' : ' busy'));
      const l1 = el('span', 'l1');
      l1.append(el('b', '', i.label || i.instance));
      if (i.label) l1.append(el('span', 'id', i.instance));
      if (active) l1.append(el('span', 'on', '✓'));
      const state = ready ? (i.clock?.now ? '🕰  ' + fmt(i.clock.now) : host(url)) : '⏳  ' + (i.busy ? 'occupée' : i.lastJob.status);
      b.append(l1, el('span', 'l2', state));
      b.title = [
        url,
        i.clock?.now && 'Date simulée : ' + fmt(i.clock.now),
        [ver('back'), ver('front')].filter(Boolean).join(' · '),
        i.creator && 'Créée par ' + i.creator,
        i.lifetime?.expiresAt && !i.lifetime.keep && 'Expire : ' + fmt(i.lifetime.expiresAt),
        !ready && 'État : ' + (i.busy ? 'occupée' : i.lastJob.status),
      ].filter(Boolean).join('\n');
      b.addEventListener('click', () => { input.value = url; apply(false); });
      return b;
    }));
  }

  // Affiche un champ dans le panneau (onglet).
  function selectField(i) {
    fi = i;
    clearTimeout(inpTimer);
    input.value = getUrl(); input.style.borderColor = ''; inpSt.hidden = true;
    input.placeholder = field().def;
    render(); renderHistory(); renderTT(); pingCurrent();
    setTimeout(() => input.focus(), 0);
  }
  function toggle(open = !panel.classList.contains('open')) {
    panel.classList.toggle('open', open);
    if (open) {
      histPings.clear(); ttReq = null;
      // Onglet par défaut : le premier champ qui a une URL custom.
      const i = FIELDS.findIndex((f) => getUrl(f));
      selectField(i < 0 ? 0 : i);
    }
  }
  // save = false : URL non mémorisée dans l'historique (instances Time-traveler, éphémères).
  async function apply(save = true) {
    const url = normalize(input.value);
    if (!url) return reset();
    try { new URL(url); } catch { input.style.borderColor = '#e63946'; return; }
    const id = histId();
    writeUrls({ [field().id]: url });
    if (save && !(await pushHistory(url, id).catch(() => false))) {
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
  $('.apply').addEventListener('click', () => apply());
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
  loadPillTT();
  new MutationObserver(mount).observe(document, { childList: true, subtree: false });
  document.addEventListener('DOMContentLoaded', mount);
  setInterval(mount, 2000);
})();
