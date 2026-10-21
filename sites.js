// Sites gérés, partagé entre l'overlay (content.js) et la popup.
//
// Chaque site stocke ses URL custom dans un store zustand persisté en localStorage
// ({ state: { data: { <champ>: url } }, version }). Un site peut avoir plusieurs champs
// (ligue1.com : L1 / FL1 / Fanbase, comme sur https://ligue1.com/en/debug-mode).
//   key     : clé localStorage du store
//   version : version zustand, utilisée seulement si le store n'existe pas encore
//   fields  : { id (champ dans state.data), label, def (URL par défaut en prod),
//               dev (URL par défaut sur dev.* etc. ; sinon def), status (chemin de ping) }
(() => {
  if (globalThis.ApiUrlSites) return;

  const SITES = {
    MPG: {
      title: 'MPG', domain: 'mpg.football', key: 'mmkv.default\\debug', version: 0,
      fields: [{ id: 'url', label: 'API', def: 'https://api.mpg.football', dev: 'https://dev.api.mpg.football', status: '/app/status' }],
    },
    MPP: {
      title: 'MPP', domain: 'mpp.football', key: 'debug', version: 0,
      fields: [{ id: 'url', label: 'API', def: 'https://api.mpp.football', dev: 'https://dev.api.monpetitprono.com', status: '/app/status' }],
    },
    L1: {
      title: 'Ligue 1', domain: 'ligue1.com', key: 'mmkv.default\\debug', version: 1,
      fields: [
        { id: 'L1Url', label: 'L1', def: 'https://ma-api.ligue1.fr', status: '/app/status' },
        { id: 'FL1Url', label: 'FL1', def: 'https://api.mpg.football/fantasy', status: '/app/status' },
        { id: 'fanbaseUrl', label: 'Fanbase', def: 'https://is-fans-prod-fanbase-api.azurewebsites.net', status: '/health' },
      ],
    },
  };

  const onDomain = (h, d) => h === d || h.endsWith('.' + d);
  function detect(hostname) {
    for (const [name, cfg] of Object.entries(SITES)) {
      if (onDomain(hostname, cfg.domain)) return { name, ...cfg };
    }
    return null;
  }
  // Environnement : prod = domaine nu (ou www.), tout le reste (dev., staging., …) = dev.
  const envOf = (site, hostname) => (hostname.replace(/^www\./, '') === site.domain ? 'prod' : 'dev');
  // Clé d'historique, séparée prod / dev. Prod : inchangée (compatibilité), un seul champ → nom du site.
  const historyId = (site, field, env = 'prod') =>
    (site.fields.length > 1 ? site.name + '_' + field.id : site.name) + (env === 'dev' ? '_dev' : '');

  // Champs avec l'URL par défaut de l'environnement (def = dev si défini).
  const fieldsFor = (site, env) => site.fields.map((f) => ({ ...f, def: (env === 'dev' && f.dev) || f.def }));

  globalThis.ApiUrlSites = { SITES, detect, envOf, historyId, fieldsFor };
})();
