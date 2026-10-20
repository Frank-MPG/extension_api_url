// Bouton « Mises à jour » commun aux popups des extensions MPG.
// Source unique : _shared/update.js — copiée dans chaque extension par build.sh.
//
//   <span data-mpg-update></span>        (n'importe où dans la popup)
//   <script src="update.js"></script>    (après l'élément ; pas de script inline : CSP MV3)
//
// - Installée depuis le Chrome Web Store : vérifie la présence d'une nouvelle version
//   (chrome.runtime.requestUpdateCheck) et l'applique tout de suite (chrome.runtime.reload).
//   Une vérification silencieuse est aussi faite à l'ouverture (au plus 1 fois par heure).
// - Chargée « non empaquetée » (installée par le raccourci « Extensions MPG », ou en dev) : le bouton
//   recharge l'extension depuis le disque. Les mises à jour arrivent par le raccourci (cf. autoreload.js).
(() => {
  if (window.MpgUpdate) return;
  const AUTO_EVERY = 60 * 60 * 1000;
  const LAST_KEY = 'mpgUpdateLastCheck';
  const version = chrome.runtime.getManifest().version;

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

    isDev().then((dev) => {
      if (dev) {
        set(`v${version} · recharger`, '', 'Recharge l\'extension depuis son dossier. Pour récupérer une nouvelle version : lancer le raccourci « Extensions MPG ».');
        btn.onclick = () => chrome.runtime.reload();
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
