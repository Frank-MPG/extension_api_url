// Bouton « Mises à jour » commun aux popups des extensions MPG.
// Source unique : _shared/update.js — copiée dans chaque extension par build.sh.
//
//   <span data-mpg-update></span>        (n'importe où dans la popup)
//   <script src="update.js"></script>    (après l'élément ; pas de script inline : CSP MV3)
//
// - Installée depuis le Chrome Web Store : vérifie la présence d'une nouvelle version
//   (chrome.runtime.requestUpdateCheck) et l'applique tout de suite (chrome.runtime.reload).
//   Une vérification silencieuse est aussi faite à l'ouverture (au plus 1 fois par heure).
// - Chargée « non empaquetée » (installée par le raccourci « Extensions MPG », ou en dev) : compare la
//   version qui tourne à la dernière release GitHub (dépôt = `homepage_url` du manifest, mis en cache 1 h,
//   clic = revérifier) et à manifest.json sur le disque :
//     · release plus récente → « vX disponible » ; clic = lance le raccourci « Extensions MPG »
//     · disque plus récent (fichiers remplacés, pas encore rechargée) → « recharger vX » ; clic = recharge
//     · sinon → « vX · à jour »
//   Les mises à jour arrivent par le raccourci (puis rechargement auto, cf. autoreload.js).
(() => {
  if (window.MpgUpdate) return;
  const AUTO_EVERY = 60 * 60 * 1000;
  const LAST_KEY = 'mpgUpdateLastCheck';
  const RELEASE_KEY = 'mpgUpdateLatestRelease';
  const SHORTCUT_URL = 'shortcuts://run-shortcut?name=' + encodeURIComponent('Extensions MPG');
  const manifest = chrome.runtime.getManifest();
  const version = manifest.version;
  // github.com/<owner>/<repo> depuis homepage_url
  const repo = (String(manifest.homepage_url || '').match(/github\.com\/([^/]+\/[^/#?]+)/) || [])[1] || '';
  const cmp = (a, b) => {
    const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
    return 0;
  };
  async function diskVersion() {
    try { return (await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json()).version; }
    catch { return version; }
  }
  // Dernière release GitHub (API publique, 60 requêtes / h / IP : on met en cache)
  async function latestRelease(force) {
    if (!repo) return null;
    try {
      const c = JSON.parse(localStorage.getItem(RELEASE_KEY) || 'null');
      if (!force && c && c.repo === repo && Date.now() - c.ts < AUTO_EVERY) return c.version;
    } catch {}
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub : HTTP ${res.status}`);
    const v = String((await res.json()).tag_name || '').replace(/^v/, '');
    try { localStorage.setItem(RELEASE_KEY, JSON.stringify({ repo, version: v, ts: Date.now() })); } catch {}
    return v;
  }
  function runShortcut() {
    const a = document.createElement('a'); a.href = SHORTCUT_URL; a.rel = 'noopener';
    document.body.append(a); a.click(); a.remove();
  }

  const css = `
    .mpgu{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border:1px solid currentColor;border-radius:999px;
      background:transparent;color:inherit;font:600 11px/1.3 system-ui,-apple-system,sans-serif;cursor:pointer;opacity:.62;
      white-space:nowrap;transition:opacity .15s}
    .mpgu:hover,.mpgu:focus-visible{opacity:1}
    .mpgu:disabled{cursor:default}
    .mpgu svg{width:11px;height:11px;flex-shrink:0}
    .mpgu.busy svg{animation:mpgu-spin .8s linear infinite}
    .mpgu.ok{opacity:.85}
    .mpgu.new{opacity:1;border-color:#34d399;color:#34d399}
    .mpgu.err{opacity:1;border-color:#f87171;color:#f87171}
    @keyframes mpgu-spin{to{transform:rotate(360deg)}}`;
  const ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const getLast = () => { try { return +localStorage.getItem(LAST_KEY) || 0; } catch { return 0; } };
  const setLast = () => { try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch {} };

  async function isDev() {
    try { return (await chrome.management.getSelf()).installType === 'development'; }
    catch { return !('update_url' in chrome.runtime.getManifest()); }
  }

  function mount(host) {
    if (!host) return;
    if (!document.getElementById('mpgu-style')) {
      const s = document.createElement('style'); s.id = 'mpgu-style'; s.textContent = css; document.head.append(s);
    }
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'mpgu';
    host.append(btn);

    const set = (label, cls = '', title = '') => {
      btn.className = 'mpgu' + (cls ? ' ' + cls : '');
      btn.innerHTML = ICON + '<span></span>';
      btn.lastChild.textContent = label;
      btn.title = title;
    };

    let installing = false;
    const apply = (v) => {
      installing = true;
      set(`Installation v${v || ''}…`.replace(' v…', '…'), 'new busy', 'La popup va se fermer. Recharge les onglets ouverts pour utiliser la nouvelle version.');
      btn.disabled = true;
      let done = false;
      const go = () => { if (!done) { done = true; chrome.runtime.reload(); } };
      chrome.runtime.onUpdateAvailable.addListener(go);
      setTimeout(go, 8000); // la mise à jour est déjà téléchargée dans la plupart des cas
    };

    async function check(silent) {
      if (!silent) { set('Vérification…', 'busy'); btn.disabled = true; }
      setLast();
      try {
        const r = await chrome.runtime.requestUpdateCheck();
        const status = r && (r.status || r);
        if (status === 'update_available') {
          if (silent) {
            set(`Nouvelle version v${r.version}`, 'new', 'Cliquer pour installer maintenant');
            btn.onclick = () => apply(r.version);
          } else apply(r.version);
        } else if (status === 'throttled') {
          if (!silent) set(`v${version} · réessaie plus tard`, 'err', 'Chrome limite le nombre de vérifications : réessaie dans quelques minutes.');
        } else if (!silent) {
          set(`v${version} · à jour`, 'ok', 'Aucune nouvelle version disponible');
        }
      } catch (e) {
        if (!silent) set(`v${version} · erreur`, 'err', String(e && e.message || e));
      } finally { btn.disabled = installing; }
    }

    // Non empaquetée : release GitHub + version sur le disque
    async function checkUnpacked(force) {
      if (force) { set('Vérification…', 'busy'); btn.disabled = true; }
      try {
        const disk = await diskVersion();
        if (cmp(disk, version) > 0) {
          set(`Recharger v${disk}`, 'new', `Les fichiers sont en v${disk}, Chrome exécute encore la v${version}. Cliquer pour recharger (la popup se ferme ; recharge ensuite les onglets ouverts).`);
          btn.onclick = () => chrome.runtime.reload();
          return;
        }
        let latest = null, err = '';
        try { latest = await latestRelease(force); } catch (e) { err = String(e && e.message || e); }
        if (latest && cmp(latest, version) > 0) {
          set(`v${latest} disponible`, 'new', `Tu as la v${version}. Cliquer pour lancer le raccourci « Extensions MPG » (ou le lancer depuis l'app Raccourcis) : l'extension se recharge ensuite toute seule.`);
          btn.onclick = runShortcut;
          return;
        }
        if (err) set(`v${version}`, force ? 'err' : '', `Impossible de vérifier les mises à jour (${err}). Cliquer pour réessayer.`);
        else set(`v${version} · à jour`, 'ok', (latest ? `Dernière version publiée : v${latest}.` : 'Pas de dépôt GitHub renseigné (homepage_url).') + ' Cliquer pour revérifier.');
        btn.onclick = () => checkUnpacked(true);
      } finally { btn.disabled = false; }
    }

    isDev().then((dev) => {
      if (dev) {
        set(`v${version}`, '', 'Vérification des mises à jour…');
        btn.onclick = () => checkUnpacked(true);
        checkUnpacked(false);
        return;
      }
      set(`v${version} · mises à jour`, '', 'Vérifier les mises à jour');
      btn.onclick = () => check(false);
      if (Date.now() - getLast() > AUTO_EVERY) check(true);
    });
  }

  window.MpgUpdate = { mount, version };
  const auto = () => document.querySelectorAll('[data-mpg-update]').forEach((el) => { if (!el.dataset.mpgUpdateOn) { el.dataset.mpgUpdateOn = '1'; mount(el); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
