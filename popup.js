// Popup de secours : agit directement sur le localStorage de l'onglet actif,
// sans dépendre du content script ni de l'app.
const $ = (id) => document.getElementById(id);

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
function siteOf(tab) {
  try { return ApiUrlSites.detect(new URL(tab.url).hostname); } catch { return null; }
}

// Exécuté dans la page. ids : champs à modifier (reset : tous ceux passés).
function pageOp(action, key, version, ids, url) {
  let o; try { o = JSON.parse(localStorage.getItem(key)); } catch {}
  const data = o?.state?.data || {};
  if (action === 'get') return Object.fromEntries(ids.map((id) => [id, data[id] || '']));
  o = o || { state: { _hasHydrated: true, data: {} }, version };
  o.state = o.state || {}; o.state.data = o.state.data || {};
  for (const id of ids) {
    if (action === 'set' && url) o.state.data[id] = url; else delete o.state.data[id];
  }
  localStorage.setItem(key, JSON.stringify(o));
  location.reload();
  return 'ok';
}

async function run(site, action, ids, url) {
  const tab = await activeTab();
  const [r] = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, func: pageOp, args: [action, site.key, site.version, ids, url ?? null],
  });
  return r?.result;
}

function normalize(v) {
  v = (v || '').trim();
  if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
  return v;
}

(async () => {
  const tab = await activeTab();
  const site = tab && siteOf(tab);
  if (!site) {
    $('cur').textContent = "Ouvre un onglet mpg.football, mpp.football ou ligue1.com pour utiliser l'extension.";
    $('apply').disabled = $('reset').disabled = $('url').disabled = true;
    return;
  }
  const multi = site.fields.length > 1;
  const env = ApiUrlSites.envOf(site, new URL(tab.url).hostname); // historique séparé prod / dev
  document.querySelector('h1').textContent = site.title + (env === 'dev' ? ' (dev)' : '') + ' – API URL' + (multi ? 's' : '');
  const urls = await run(site, 'get', site.fields.map((f) => f.id));

  // Sélecteur de champ (ligue1.com : L1 / FL1 / Fanbase).
  const sel = $('field');
  if (multi) {
    sel.hidden = false;
    sel.replaceChildren(...site.fields.map((f) => new Option(f.label + (urls[f.id] ? ' • custom' : ''), f.id)));
    const first = site.fields.find((f) => urls[f.id]);
    if (first) sel.value = first.id;
  }
  const fields = ApiUrlSites.fieldsFor(site, env); // URL par défaut selon prod / dev
  const field = () => fields.find((f) => f.id === (multi ? sel.value : fields[0].id));
  function show() {
    const f = field(), url = urls[f.id];
    $('url').value = url;
    $('url').placeholder = f.def;
    $('cur').innerHTML = url ? 'Actuelle : <b></b>' : '';
    if (url) $('cur').querySelector('b').textContent = url;
    else $('cur').textContent = 'Actuelle : défaut (' + f.def.replace(/^https?:\/\//, '') + ')';
    $('reset').textContent = multi ? 'Reset ' + f.label : 'Reset';
  }
  sel.addEventListener('change', show);
  show();

  $('apply').onclick = async () => {
    const v = normalize($('url').value);
    if (!v) return $('reset').onclick();
    try { new URL(v); } catch { $('msg').textContent = 'URL invalide.'; return; }
    const f = field();
    await run(site, 'set', [f.id], v);
    try { await ApiUrlHistory.push(ApiUrlSites.historyId(site, f, env), v); } catch {}
    window.close();
  };
  $('reset').onclick = async () => { await run(site, 'reset', [field().id]); window.close(); };
  $('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('apply').onclick(); });
})();
