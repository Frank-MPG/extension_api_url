// Historique des API URL, partagé entre l'overlay (content.js) et la popup.
//
// Persistance double :
//   - chrome.storage.sync  : survit à une désinstallation / réinstallation de l'extension
//                            et suit le profil Chrome sur les autres postes (si la synchro est active) ;
//   - chrome.storage.local : copie de secours, toujours dispo.
// Chaque écriture va dans les deux, horodatée. À la lecture on garde la copie la plus
// récente et on répare l'autre si elle manque ou est en retard.
//
// Format stocké : { items: [{ url, pinned }], at: <timestamp> }
// (l'ancien format — tableau de chaînes ou d'objets dans storage.local — est migré à la volée).
(() => {
  if (globalThis.ApiUrlHistory) return;

  const MAX_UNPINNED = 20;
  const SYNC_MAX_BYTES = 7500; // quota storage.sync : 8 192 octets par clé (clé incluse)
  const keyOf = (site) => 'apiUrlHistory_' + site;

  // Après une mise à jour / un rechargement de l'extension, les content scripts déjà
  // injectés perdent l'accès à chrome.* : on le détecte pour ne pas afficher un historique vide.
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

  function parse(v) {
    if (v == null) return null;
    const raw = Array.isArray(v) ? v : v.items;
    if (!Array.isArray(raw)) return null;
    const items = raw
      .map((e) => (typeof e === 'string' ? { url: e, pinned: false } : { url: e?.url, pinned: !!e?.pinned }))
      .filter((e) => typeof e.url === 'string' && e.url);
    return { items, at: Array.isArray(v) ? 0 : +v.at || 0 };
  }

  async function readArea(area, k) {
    try { return parse((await chrome.storage[area].get(k))[k]); } catch { return null; }
  }
  async function writeArea(area, k, value) {
    try { await chrome.storage[area].set({ [k]: value }); return true; } catch { return false; }
  }

  function trim(items) {
    const seen = new Set();
    items = items.filter((e) => !seen.has(e.url) && seen.add(e.url));
    const pinned = items.filter((e) => e.pinned);
    const others = items.filter((e) => !e.pinned).slice(0, MAX_UNPINNED);
    return [...pinned, ...others];
  }
  // storage.sync refuse une valeur trop grosse : on retire les plus anciennes non épinglées.
  function fitForSync(k, value) {
    const v = { ...value, items: [...value.items] };
    const size = () => k.length + JSON.stringify(v).length;
    while (size() > SYNC_MAX_BYTES) {
      const i = v.items.map((e) => e.pinned).lastIndexOf(false);
      if (i < 0) break;
      v.items.splice(i, 1);
    }
    return v;
  }

  async function get(site) {
    if (!alive()) return [];
    const k = keyOf(site);
    const [s, l] = await Promise.all([readArea('sync', k), readArea('local', k)]);
    const best = [s, l].filter(Boolean).sort((a, b) => b.at - a.at)[0];
    if (!best) return [];
    // Auto-réparation : une copie absente (réinstallation, quota…) ou plus ancienne est réécrite.
    const value = { items: trim(best.items), at: best.at || Date.now() };
    if (!s || s.at !== value.at) writeArea('sync', k, fitForSync(k, value));
    if (!l || l.at !== value.at) writeArea('local', k, value);
    return value.items;
  }

  // Écritures sérialisées pour éviter qu'un double clic rapide écrase une modif.
  let chain = Promise.resolve();
  function update(site, fn) {
    const run = chain.then(async () => {
      if (!alive()) return false;
      const k = keyOf(site);
      const value = { items: trim(fn(await get(site))), at: Date.now() };
      const [okSync, okLocal] = await Promise.all([
        writeArea('sync', k, fitForSync(k, value)),
        writeArea('local', k, value),
      ]);
      return okSync || okLocal;
    });
    chain = run.catch(() => false);
    return run;
  }

  globalThis.ApiUrlHistory = {
    alive,
    key: keyOf,
    get,
    // Ajoute / remonte une URL en tête (conserve son état épinglé). Renvoie true si sauvegardé.
    push: (site, url) => update(site, (h) => [{ url, pinned: !!h.find((e) => e.url === url)?.pinned }, ...h.filter((e) => e.url !== url)]),
    remove: (site, url) => update(site, (h) => h.filter((e) => e.url !== url)),
    togglePin: (site, url) => update(site, (h) => h.map((e) => (e.url === url ? { ...e, pinned: !e.pinned } : e))),
    clear: (site) => update(site, (h) => h.filter((e) => e.pinned)),
  };
})();
