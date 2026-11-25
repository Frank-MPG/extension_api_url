// MPG / MPP / L1 – Changer d'API : overlay injecté par l'extension (indépendant de l'app React),
// donc toujours disponible même si l'app plante à cause d'une mauvaise API URL.
(() => {
  if (window.__mppApiUrlOverlay) return;
  window.__mppApiUrlOverlay = true;

  // Config du site (sites.js) : clé du store zustand, champs d'URL, URL par défaut.
  const site = globalThis.ApiUrlSites.detect(location.host);
  if (!site) return;
  const ENV = globalThis.ApiUrlSites.envOf(site, location.host); // historique séparé prod / dev
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
      .pill, .panel, .clock, .slot { font-family:system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing:antialiased; }
      button, input { font-family:inherit; }
      /* Pastilles « verre dépoli » : fond sombre translucide flouté, la couleur de l'état n'est qu'un accent
         (liseré --ring, halo --glow, point, icône). Gris = API par défaut, rose = custom, violet = Time-traveler. */
      .pill, .clock, .sh2 { --ring:rgba(255,255,255,.12); --glow:0,0,0; background:rgba(22,24,32,.72);
        backdrop-filter:blur(12px) saturate(1.4); -webkit-backdrop-filter:blur(12px) saturate(1.4);
        box-shadow:inset 0 0 0 1px var(--ring), 0 6px 20px rgba(var(--glow),.28); }
      .clock, .sh2, .pill.ttp { --ring:rgba(160,130,255,.75); --glow:120,80,255; }
      .pill { display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none;
        padding:7px 9px 7px 13px; border-radius:999px; border:none; color:#fff; font-size:14px; font-weight:650; letter-spacing:.01em;
        transition:filter .15s; }
      .pill:hover { filter:brightness(1.15); }
      .pill.custom { --ring:rgba(255,92,122,.75); --glow:255,60,100; transform-origin:center; animation:heartbeat 1.4s ease-in-out infinite; }
      .pill.ttp { --ring:rgba(160,130,255,.75); --glow:120,80,255; }
      .pill.custom:hover { animation-play-state:paused; }
      /* Battement de cœur : double pulsation "lub-dub" + halo de la couleur de l'état qui s'étend */
      @keyframes heartbeat {
        0%   { transform:scale(1);    box-shadow:inset 0 0 0 1px var(--ring), 0 6px 20px rgba(var(--glow),.28), 0 0 0 0 rgba(var(--glow),.35); }
        14%  { transform:scale(1.03); }
        28%  { transform:scale(1); }
        42%  { transform:scale(1.03); box-shadow:inset 0 0 0 1px var(--ring), 0 6px 20px rgba(var(--glow),.35), 0 0 0 4px rgba(var(--glow),.15); }
        70%  { transform:scale(1);    box-shadow:inset 0 0 0 1px var(--ring), 0 6px 20px rgba(var(--glow),.28), 0 0 0 7px rgba(var(--glow),0); }
        100% { transform:scale(1);    box-shadow:inset 0 0 0 1px var(--ring), 0 6px 20px rgba(var(--glow),.28), 0 0 0 0 rgba(var(--glow),0); }
      }
      @media (prefers-reduced-motion: reduce) { .pill.custom { animation:none; } .tt { transition:none; } }
      /* URL utilisée, en retrait à droite du label */
      .pill .pu { font:500 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; color:#c9cfdb;
        background:rgba(255,255,255,.07); padding:3px 10px; border-radius:999px;
        max-width:520px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      /* Heure dans l'instance Time-traveler : pastille à part, au-dessus, hors animation de la principale */
      /* Ligne heure + bouton « dates d'aujourd'hui » (déplacée ensemble entre le coin et le header) */
      .cw { display:flex; align-items:center; gap:6px; width:max-content; margin-bottom:7px; }
      .cw.docked, .cw:has(> .clock[hidden]) { margin:0; }
      .clock { display:flex; align-items:center; gap:7px; width:max-content; padding:5px 13px 5px 11px; border-radius:999px; color:#fff;
        font-size:13px; font-weight:600; cursor:grab; user-select:none; -webkit-user-select:none; touch-action:none; }
      .clock .dt, .clock .tm { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric:tabular-nums; }
      .clock .dt { color:#b9a8ff; }
      .clock.paused { --ring:rgba(255,201,77,.85); --glow:255,180,40; }
      .clock.paused .dt, .clock.paused .tm { color:#ffc94d; }
      .clock.paused .tm::after { content:' · EN PAUSE'; font:700 11px system-ui, -apple-system, sans-serif; letter-spacing:.6px; }
      .clock.docked.paused .tm::after { display:block; text-align:center; font-size:9.5px; }
      /* Bouton rond détaché, à droite de l'heure : violet = dates de l'instance, ambre = dates ramenées à aujourd'hui */
      .sh2 { flex:none; display:grid; place-items:center; width:28px; height:28px; padding:0; border-radius:50%; cursor:pointer;
        border:none; color:#b9a8ff; transition:transform .12s, filter .15s; }
      .sh2:hover { transform:scale(1.1); filter:brightness(1.25); }
      .sh2:active { transform:scale(.95); }
      .sh2:focus-visible { outline:2px solid #fff; outline-offset:2px; }
      .sh2.on { --ring:#ffc94d; --glow:255,201,77; color:#ffc94d; box-shadow:inset 0 0 0 1.5px var(--ring), 0 0 14px rgba(var(--glow),.35); }
      .sh2 svg { width:16px; height:16px; }
      .cw.docked .sh2 { width:34px; height:34px; }
      .cw.docked .sh2 svg { width:19px; height:19px; }
      .cw:not(:has(.clock)) .sh2 { display:none; } /* pendant le glisser-déposer de l'heure */
      /* Dans le header du site (glisser-déposer) : grosse horloge à la hauteur des menus, date au-dessus de l'heure */
      .clock.docked { margin:0; min-width:150px; height:40px; flex-direction:column; align-items:center; justify-content:center;
        gap:0; padding:0 14px; border-radius:11px; }
      .clock.docked .em { display:none; }
      .clock.docked .dt { font:500 10.5px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height:1.2; }
      .clock.docked .tm { font-size:18px; font-weight:700; line-height:1.1; letter-spacing:.5px; }
      .clock.dragging { position:fixed; transform:none; margin:0; cursor:grabbing; z-index:1; opacity:.92;
        box-shadow:inset 0 0 0 1px var(--ring), 0 12px 30px rgba(var(--glow),.45); }
      /* Emplacement cible pendant le déplacement */
      .slot { display:flex; align-items:center; justify-content:center; border:2px dashed rgba(255,255,255,.8); border-radius:999px;
        background:rgba(25,20,55,.45); color:#fff; font-size:11px; font-weight:700; }
      .slot.over { background:rgba(91,63,209,.7); border-color:#fff; }
      .slot.corner { width:190px; height:27px; margin-bottom:6px; }
      .slot.head { width:170px; height:40px; border-radius:10px; }
      .pill .dot { width:9px; height:9px; border-radius:50%; background:#5ee08a; box-shadow:0 0 8px #5ee08a; }
      .pill.custom .dot { background:#ff5c7a; box-shadow:0 0 8px #ff5c7a; }
      .pill.ttp .dot { background:#a98bff; box-shadow:0 0 8px #a98bff; }
      .pill.warn .pu { color:#ffc94d; }

      /* Au-dessus de tout l'hôte (pastille + pastille d'heure éventuelle) ; 100% = hauteur de l'hôte */
      .panel { display:none; position:absolute; left:0; bottom:calc(100% + 10px); width:440px; max-width:calc(100vw - 24px);
        max-height:calc(100vh - 100% - 34px); overflow:auto; overscroll-behavior:contain;
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
    <div class="slot head" hidden>Déposer ici</div>
    <div class="slot corner" hidden>Déposer ici</div>
    <div class="cw"><div class="clock" hidden title="Heure dans l'instance Time-traveler · glisser pour la déplacer (header ↔ bas à gauche)"><span class="em">🕰</span><span class="dt"></span><span class="tm"></span></div><button class="sh2" hidden></button></div>
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
  const tabs = $('.tabs'), resetBtn = $('.reset'), now = $('.now'), clock = $('.clock');
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
    // Connecté à une instance Time-traveler : son nom et son état (ou son expiration) plutôt que l'URL.
    const tt = pillInstance(), ttUrl = onTT();
    pill.classList.toggle('ttp', ttUrl);
    pill.classList.toggle('warn', !!tt && (!!ttState?.warn || !!expiresSoon(tt)));
    lbl.textContent = ttUrl ? 'Time-traveler' : customs.length ? 'API custom' : 'API';
    renderClock();
    // URL réellement utilisée (custom ou défaut), sans le protocole ni le slash final.
    // Plusieurs champs : seules les URL custom sont listées (sinon l'URL par défaut du 1er champ).
    pill.querySelector('.pu').textContent = tt
      ? (tt.label || tt.instance) + ' · ' + (ttState?.text || expiry(tt))
      : ttUrl && ttState?.key === 'gone'
      ? host(getUrl(FIELDS[0])) + ' · indisponible'
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
  const TT_TOKEN = 'eyJpc3MiOiJ0aW1lLXRyYXZlbGVyIiwic2NvcGUiOiJpbnN0YW5jZXMiLCJqdGkiOiIxOTQ3MGE0Zi0wYWU2LTQyMzUtYTRmMS1kMzBmOWE3ZTQ4MjciLCJpYXQiOiIyMDI2LTExLTI1VDE2OjM1OjI1Ljk2MFoifQ.uthraF-2ASQlup-OXQ6IeSlZfd4NHKcqo22ANf-tTcc';
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
  function renderClock() {
    const tt = pillInstance();
    clock.hidden = shiftBtn.hidden = !Number.isFinite(tt?.skew);
    if (clock.hidden) return headHost.remove();
    const inHead = dragging ? clock.classList.contains('docked') : placeClock();
    // En pause : horloge figée à clock.now (offsetSeconds, lui, recule avec le temps réel).
    const paused = !!tt.clock?.paused, d = new Date(paused ? Date.parse(tt.clock.now) : Date.now() + tt.skew);
    clock.classList.toggle('paused', paused);
    clock.querySelector('.em').textContent = paused ? '⏸' : '🕰';
    clock.querySelector('.dt').textContent = d.toLocaleDateString('fr-FR', inHead ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { dateStyle: 'short' });
    clock.querySelector('.tm').textContent = d.toLocaleTimeString('fr-FR');
    const on = shiftOn(), days = Math.round(Math.abs(tt.skew) / 864e5);
    if (shiftBtn.classList.contains('on') !== on || !shiftBtn.firstChild) shiftBtn.innerHTML = on ? TODAY_SVG : TT_SVG;
    shiftBtn.classList.toggle('on', on);
    shiftBtn.setAttribute('aria-label', on ? 'Revenir aux dates de l\'instance' : 'Ramener les dates à aujourd\'hui');
    shiftBtn.title = (on ? 'Dates du site ramenées à aujourd\'hui : clic pour revenir aux dates de l\'instance'
      : 'Ramener toutes les dates du site à aujourd\'hui (décalage de ' + days + ' j)') + ' · recharge la page';
  }
  // « Dates d'aujourd'hui » : tt_shift.js (monde MAIN) décale les dates des réponses de l'API de l'instance.
  // Activé pour une API donnée : revenir plus tard sur la même instance le réactive.
  const SHIFT_KEY = 'apiUrlTTShift', shiftBtn = $('.sh2'), cw = $('.cw');
  // Icônes : mode instance = calendrier + flèche « vers aujourd'hui » ; mode aujourd'hui = calendrier coché, jour marqué.
  const CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>';
  const TT_SVG = CAL + '<path d="M8 15.5h7.5M13 13l2.5 2.5L13 18"/></svg>';
  const TODAY_SVG = CAL + '<path d="M8.5 15.5l2.5 2.5 4.5-4.5"/></svg>';
  const readShift = () => { try { return JSON.parse(localStorage.getItem(SHIFT_KEY)); } catch { return null; } };
  const shiftOn = () => readShift()?.api === getUrl(FIELDS[0]);
  shiftBtn.addEventListener('pointerdown', (e) => e.stopPropagation()); // pas de glisser-déposer de l'horloge
  shiftBtn.addEventListener('click', () => {
    const tt = pillInstance();
    if (!tt) return;
    if (shiftOn()) localStorage.removeItem(SHIFT_KEY);
    else localStorage.setItem(SHIFT_KEY, JSON.stringify({ api: getUrl(FIELDS[0]), skew: tt.skew }));
    location.reload();
  });
  // Glisser l'heure : bas à gauche ↔ header du site (dernier élément des menus de gauche, en grosse horloge).
  // La cible est en pointillés. Mémorisé dans chrome.storage.local (tous sites / environnements, après rechargement).
  const DOCK_KEY = 'apiUrlClockDocked';
  let docked = false, dragging = false;
  try { chrome.storage.local.get(DOCK_KEY).then((o) => { docked = !!o[DOCK_KEY]; renderClock(); }, () => {}); } catch {}
  // Dans le header, l'horloge vit dans un 2e hôte (shadow DOM fermé) ajouté à la fin de la barre des menus de gauche.
  const slotHead = $('.slot.head'), slotCorner = $('.slot.corner');
  const headHost = document.createElement('mpp-api-url-clock');
  headHost.style.cssText = 'all:initial;display:flex;align-items:center;gap:8px;';
  const headRoot = headHost.attachShadow({ mode: 'closed' });
  headRoot.append(root.querySelector('style').cloneNode(true), slotHead);
  // Classes générées par le build du site : on s'ancre sur le lien « Mon MPG » (data-testid stable).
  const headNav = () => document.querySelector('a[data-testid="(home)"]')?.parentElement || null;
  // Range l'horloge à sa place (re-ajoutée chaque seconde si l'app a redessiné le header). Sans header : en bas à gauche.
  function placeClock() {
    const nav = docked && headNav();
    if (nav && nav.lastElementChild !== headHost) nav.append(headHost);
    if (!nav) headHost.remove();
    if (clock.parentNode !== cw) cw.prepend(clock); // retour d'un glisser-déposer
    if (nav ? cw.parentNode !== headRoot : cw.nextElementSibling !== pill) nav ? headRoot.append(cw) : root.insertBefore(cw, pill);
    clock.classList.toggle('docked', !!nav);
    cw.classList.toggle('docked', !!nav);
    return !!nav;
  }
  clock.addEventListener('contextmenu', (e) => e.preventDefault());
  clock.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, fromHead = cw.parentNode === headRoot, nav = headNav();
    const zone = fromHead ? slotCorner : nav && slotHead;
    if (!zone) return; // pas de header sur cette page : nulle part où aller
    let drag = null; // écart pointeur / coin de l'horloge, dès que le pointeur a bougé
    const hit = (ev) => {
      const r = zone.getBoundingClientRect(), m = 30;
      return ev.clientX > r.left - m && ev.clientX < r.right + m && ev.clientY > r.top - m && ev.clientY < r.bottom + m;
    };
    const move = (ev) => {
      if (!drag) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return; // simple clic : rien
        const r = clock.getBoundingClientRect();
        drag = { dx: x0 - r.left, dy: y0 - r.top };
        dragging = true;
        if (!fromHead) nav.append(headHost);
        zone.hidden = false;
        root.append(clock); // l'overlay est en position:fixed, sans transform hérité du site
        clock.classList.add('dragging');
        try { clock.setPointerCapture(e.pointerId); } catch {}
      }
      Object.assign(clock.style, { left: ev.clientX - drag.dx + 'px', top: ev.clientY - drag.dy + 'px' });
      zone.classList.toggle('over', hit(ev));
    };
    const end = (ev) => {
      ['pointermove', 'pointerup', 'pointercancel'].forEach((t) => window.removeEventListener(t, t === 'pointermove' ? move : end, true));
      if (!drag) return;
      if (ev.type === 'pointerup' && hit(ev)) {
        docked = !fromHead;
        try { chrome.storage.local.set({ [DOCK_KEY]: docked }); } catch {}
      }
      zone.hidden = true; zone.classList.remove('over');
      dragging = false;
      clock.classList.remove('dragging'); clock.style.left = clock.style.top = '';
      renderClock();
    };
    ['pointermove', 'pointerup', 'pointercancel'].forEach((t) => window.addEventListener(t, t === 'pointermove' ? move : end, true));
  });
  // ---------- État de l'instance Time-traveler (cf. time-traveler/docs/api-instances-etat.md) ----------
  // Interrogé toutes les 8 s (5 s pendant un saut) tant que l'onglet est visible, seulement si l'URL est sur Time-traveler.
  const TT_HOST = new URL(TT_API).hostname;
  const onTT = () => { if (MULTI || !FIELDS[0].tt) return false; try { return new URL(getUrl(FIELDS[0])).hostname.endsWith('.' + TT_HOST); } catch { return false; } };
  const OPS = { switch: 'changement de branche', replay: '+1 but en cours', setup: 'lancement en cours', script: 'script en cours', pause: 'pause / reprise de l\'horloge' };
  // Première règle qui s'applique. block = l'API est (ou va être) inutilisable : écran pleine page.
  function instanceState(i) {
    if (!i) return { key: 'gone', block: true };
    if (i.api?.state === 'cut') return { key: 'cut', block: true };
    if (i.operation?.kind === 'goto') return { key: 'goto', block: true };
    if (i.operation) return { key: 'busy', text: '⏳ ' + (OPS[i.operation.kind] || i.operation.kind), warn: true };
    if (i.clock?.paused) return { key: 'paused', text: '⏸ horloge en pause', warn: true };
    if (i.lastJob?.status === 'error') return { key: 'error', text: '⚠ dernière opération en échec', warn: true };
    return { key: 'ready' };
  }
  const expiresSoon = (i) => !i.lifetime?.keep && i.lifetime?.expiresAt && Date.parse(i.lifetime.expiresAt) - Date.now() < 15 * 60000;
  let ttState = null, ttTimer, ttPolling = false, clockTimer;
  async function pollTT() {
    clearTimeout(ttTimer);
    if (ttPolling || !onTT() || document.hidden) return;
    ttPolling = true;
    let list;
    try { list = await fetchInstances(); } catch (e) {
      ttPolling = false;
      if (/HTTP 401/.test(e.message)) return console.warn('[API URL] Time-traveler : jeton refusé (401), état des instances indisponible');
      ttTimer = setTimeout(pollTT, 8000); // réseau : nouvel essai
      return;
    }
    ttPolling = false;
    const url = getUrl(FIELDS[0]);
    pillTT = list.find((i) => i.links?.[FIELDS[0].tt] === url) || null;
    if (pillTT) {
      const off = pillTT.clock?.offsetSeconds;
      pillTT.skew = Number.isFinite(off) ? off * 1000 : Date.parse(pillTT.clock?.now) - Date.now();
    }
    const st = instanceState(pillTT), wasBlocked = ttState?.block;
    // Fin d'un saut (ou instance revenue) : « up » ne prouve pas que l'API répond. Écran gardé jusqu'à un /app/status en 2xx.
    if (wasBlocked && !st.block) { ttState = { key: 'waking', block: true, text: '⏳ API en redémarrage' }; render(); return waitApi(); }
    ttState = st;
    if (!st.block && syncShift()) return location.reload();
    render(); renderDown();
    if (pillTT && !clockTimer) clockTimer = setInterval(renderClock, 1000); // seule l'heure, chaque seconde
    ttTimer = setTimeout(pollTT, st.block ? 5000 : 8000);
  }
  // Puis rechargement : l'heure de l'instance a changé, les données affichées sont périmées.
  async function waitApi() {
    clearTimeout(ttTimer);
    if (ttPolling) return;
    ttPolling = true;
    const r = await ping(getUrl(FIELDS[0]), FIELDS[0]);
    ttPolling = false;
    if (r.level === 'ok') { syncShift(); return location.reload(); }
    ttState.last = r.text; renderDown();
    ttTimer = setTimeout(waitApi, 3000);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ttState?.key === 'waking' ? waitApi() : pollTT(); });
  // Mode « dates d'aujourd'hui » : décalage stocké recalé si l'horloge de l'instance a bougé (> 1 min). true = changé.
  function syncShift() {
    const sh = readShift();
    if (!pillTT || pillTT.clock?.paused || !shiftOn() || !Number.isFinite(pillTT.skew) || Math.abs(sh.skew - pillTT.skew) <= 60000) return false;
    localStorage.setItem(SHIFT_KEY, JSON.stringify({ ...sh, skew: pillTT.skew }));
    return true;
  }

  // ---------- API custom qui ne répond plus : ping au chargement, nouvel essai toutes les 10 s, rechargement au retour ----------
  let down = null, downTimer;
  async function checkApis() {
    clearTimeout(downTimer);
    const rs = await Promise.all(FIELDS.filter((f) => getUrl(f)).map(async (f) => ({ f, r: await ping(getUrl(f), f) })));
    const ko = rs.find((x) => x.r.level === 'ko');
    if (down && !ko) return location.reload();
    down = ko ? { url: getUrl(ko.f), label: MULTI ? ko.f.label : '', text: ko.r.text } : null;
    renderDown();
    if (down) downTimer = setTimeout(checkApis, 10000);
  }

  // ---------- Écran pleine page (au-dessus du site, sous la pastille) : saut en cours, instance disparue, API morte ----------
  const downHost = document.createElement('mpp-api-url-down');
  downHost.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;';
  const downRoot = downHost.attachShadow({ mode: 'closed' });
  downRoot.innerHTML = `<style>
      * { box-sizing:border-box; }
      [hidden] { display:none !important; }
      .bg { position:absolute; inset:0; display:grid; place-items:center; padding:24px; overflow:auto;
        font-family:system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing:antialiased; color:#e9ecf1;
        background:radial-gradient(1200px 600px at 50% -10%, rgba(var(--glow),.22), transparent 60%), #0d0f14; }
      .bg.violet { --glow:120,80,255; --ring:rgba(160,130,255,.6); --acc:#b9a8ff; }
      .bg.red { --glow:255,60,100; --ring:rgba(255,92,122,.6); --acc:#ff8aa0; }
      .bg.gray { --glow:140,150,170; --ring:rgba(255,255,255,.18); --acc:#c9cfdb; }
      .card { width:min(520px, 100%); padding:32px; border-radius:20px; text-align:center; background:rgba(22,24,32,.8);
        box-shadow:inset 0 0 0 1px var(--ring), 0 24px 60px rgba(var(--glow),.18), 0 2px 8px rgba(0,0,0,.4); }
      .ic { font-size:44px; line-height:1; margin-bottom:14px; }
      .bg.violet .ic { animation:sway 2.4s ease-in-out infinite; }
      @keyframes sway { 50% { transform:rotate(-8deg) scale(1.05); } }
      @media (prefers-reduced-motion: reduce) { .ic { animation:none !important; } }
      h1 { margin:0 0 8px; font-size:22px; font-weight:700; }
      p { margin:0 0 6px; font-size:14.5px; line-height:1.5; color:#b7bec9; }
      .u { display:inline-block; max-width:100%; margin:10px 0 4px; padding:5px 12px; border-radius:999px; overflow:hidden; text-overflow:ellipsis;
        white-space:nowrap; font:500 13px ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--acc); background:rgba(255,255,255,.06); }
      .tg { margin-top:14px; font-size:14px; color:#c9cfdb; } .tg b { color:var(--acc); }
      .pr { margin-top:16px; text-align:left; }
      .bar { height:8px; border-radius:999px; background:rgba(255,255,255,.08); overflow:hidden; }
      .bar i { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg, #7b5cff, #b9a8ff);
        box-shadow:0 0 12px rgba(var(--glow),.6); transition:width .4s; }
      .bar.ind i { width:35% !important; animation:ind 1.4s ease-in-out infinite; }
      @keyframes ind { from { transform:translateX(-100%); } to { transform:translateX(290%); } }
      .pl { display:flex; justify-content:space-between; gap:12px; margin-top:7px; font-size:12.5px; color:#9aa3b2; }
      .pl span:last-child { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .wn { margin-top:8px; font-size:12.5px; color:#ffc94d; }
      .row { display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin-top:24px; }
      button { font:600 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding:10px 16px; border-radius:10px; cursor:pointer;
        border:none; color:#e9ecf1; background:rgba(255,255,255,.07); box-shadow:inset 0 0 0 1px rgba(255,255,255,.12); transition:filter .15s; }
      button:hover { filter:brightness(1.3); }
      button:focus-visible { outline:2px solid #fff; outline-offset:2px; }
      button.pri { color:#fff; background:rgba(var(--glow),.35); box-shadow:inset 0 0 0 1px var(--ring); }
      .au { margin-top:16px; font-size:12px; color:#7d8696; }
    </style>
    <div class="bg"><div class="card" role="alert">
      <div class="ic"></div><h1></h1><p class="tx"></p><div class="u"></div>
      <div class="tg"></div>
      <div class="pr"><div class="bar"><i></i></div><div class="pl"><span class="pn"></span><span class="pc"></span></div><div class="wn"></div></div>
      <div class="row">
        <button class="pri" data-a="retry">Réessayer</button>
        <button data-a="pick">Choisir une autre API</button>
        <button data-a="reset">Revenir à l'API par défaut</button>
      </div>
      <div class="au"></div>
    </div></div>`;
  downRoot.addEventListener('click', (e) => {
    const a = e.target.closest?.('button')?.dataset.a;
    if (a === 'retry') ttState?.key === 'waking' ? waitApi() : ttState?.block ? pollTT() : checkApis();
    if (a === 'pick') toggle(true);
    if (a === 'reset') reset(true);
  });
  const D = (s) => downRoot.querySelector(s);
  function downView() {
    const s = ttState, op = pillTT?.operation;
    if (s?.key === 'gone') return { tone: 'gray', icon: '🛰️', title: 'Instance Time-traveler indisponible',
      text: 'Elle est éteinte, supprimée ou remise en réserve : son API ne répondra plus. Choisis une autre instance ou reviens à l\'API par défaut.',
      url: getUrl(FIELDS[0]), auto: 'Vérification automatique toutes les 5 s.' };
    if (s?.key === 'waking') return { tone: 'violet', icon: '🕰️', title: 'Saut terminé, l\'API redémarre',
      text: 'Le site revient dès que ' + FIELDS[0].status + ' répond.' + (s.last ? ' Dernier essai : ' + s.last + '.' : ''),
      url: (pillTT.label || pillTT.instance) + ' · ' + host(getUrl(FIELDS[0])), progress: true, wait: 'En attente de l\'API…',
      auto: 'Nouvel essai toutes les 3 s, puis rechargement de la page.' };
    if (s?.block) return { tone: 'violet', icon: '🕰️', title: 'Saut dans le temps en cours',
      text: s.key === 'cut' ? 'L\'API de l\'instance est coupée le temps du saut : le site est mis en pause.'
        : 'Le saut démarre ou se termine : l\'API va être coupée ou vient d\'être rétablie.',
      url: (pillTT.label || pillTT.instance) + ' · ' + host(getUrl(FIELDS[0])),
      target: op?.at, steps: op?.steps || null, progress: true,
      auto: 'La page se recharge toute seule à la fin du saut.' };
    if (down) return { tone: 'red', icon: '🔌', title: (down.label ? 'L\'API ' + down.label : 'Cette API') + ' ne répond pas',
      text: down.text + '. Le site ne peut pas fonctionner avec cette URL.', url: down.url,
      auto: 'Nouvel essai automatique toutes les 10 s : la page se recharge dès qu\'elle répond.' };
    return null;
  }
  function renderDown() {
    const v = downView();
    if (!v) return downHost.remove();
    D('.bg').className = 'bg ' + v.tone;
    D('.ic').textContent = v.icon; D('h1').textContent = v.title; D('.tx').textContent = v.text;
    D('.u').textContent = v.url; D('.u').title = v.url;
    D('.tg').hidden = !v.target;
    if (v.target) D('.tg').innerHTML = 'Destination : <b></b>', D('.tg b').textContent = fmt(v.target);
    D('.pr').hidden = !v.progress;
    const st = v.steps, pct = st?.total ? Math.min(100, Math.round((st.done / st.total) * 100)) : 0;
    D('.bar').classList.toggle('ind', !st?.total);
    D('.bar i').style.width = pct + '%';
    D('.pn').textContent = st?.total ? st.done + ' / ' + st.total + ' étapes' : v.wait || 'Progression indisponible';
    D('.pc').textContent = st?.current || ''; D('.pc').title = st?.current || '';
    D('.wn').hidden = !(st?.failed > 0);
    D('.wn').textContent = st?.failed > 0 ? '⚠ ' + st.failed + ' étape' + (st.failed > 1 ? 's' : '') + ' en échec : le saut continue jusqu\'à sa destination.' : '';
    D('.au').textContent = v.auto;
    if (!downHost.isConnected && document.documentElement) document.documentElement.appendChild(downHost);
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
      const state = ready ? (i.clock?.now ? (i.clock.paused ? '⏸  ' : '🕰  ') + fmt(i.clock.now) : host(url)) : '⏳  ' + (i.busy ? 'occupée' : i.lastJob.status);
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
    if (parent && !downHost.isConnected && downView()) parent.appendChild(downHost);
  }
  mount();
  render();
  pollTT();
  checkApis();
  new MutationObserver(mount).observe(document, { childList: true, subtree: false });
  document.addEventListener('DOMContentLoaded', mount);
  setInterval(mount, 2000);
})();
