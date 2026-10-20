// Rechargement automatique après une mise à jour par le raccourci « Extensions MPG ».
// Source unique : _shared/autoreload.js — copiée dans chaque extension par build.sh.
//
// Les extensions sont installées « non empaquetées » : quand le raccourci remplace les
// fichiers sur le disque, Chrome continue d'exécuter l'ancienne version. Ce service worker
// relit manifest.json sur le disque toutes les minutes et recharge l'extension dès que la
// version a changé (install.sh copie manifest.json en dernier : quand la version change,
// tous les autres fichiers sont déjà en place).
//
// Utilisation : "background": { "service_worker": "autoreload.js" } + permission "alarms",
// ou importScripts('/autoreload.js') en tête d'un service worker existant.
(() => {
  const ALARM = 'mpg-autoreload';
  const running = chrome.runtime.getManifest().version;

  async function check() {
    try {
      const res = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
      const onDisk = (await res.json()).version;
      if (onDisk && onDisk !== running) chrome.runtime.reload();
    } catch {
      // fichier en cours de copie ou JSON invalide : on réessaiera à la prochaine minute
    }
  }

  chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) check(); });
  chrome.alarms.get(ALARM).then((a) => { if (!a) chrome.alarms.create(ALARM, { periodInMinutes: 1 }); });
  check();
})();
