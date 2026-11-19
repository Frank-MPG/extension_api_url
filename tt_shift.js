// Time-traveler « dates d'aujourd'hui » (monde MAIN, document_start) : réécrit les dates ISO des réponses JSON
// de l'API de l'instance (-skew) pour que le site les affiche ramenées à aujourd'hui, et fait l'inverse (+skew)
// sur les corps JSON envoyés à cette API pour ne rien enregistrer de faux dans l'instance.
// Activé par content.js : localStorage.apiUrlTTShift = { api, skew } (skew = heure instance − heure réelle, en ms).
(() => {
  let cfg; try { cfg = JSON.parse(localStorage.getItem('apiUrlTTShift')); } catch {}
  if (!cfg?.api || !Number.isFinite(cfg.skew)) return;

  // Garde le format d'origine (secondes, millisecondes, Z / décalage / heure locale) : le front peut découper la chaîne.
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
  function shiftIso(s, delta) {
    const m = ISO.exec(s), t = m && Date.parse(s);
    if (!m || Number.isNaN(t)) return s;
    const [, sec, ms, tz] = m, u = t + delta;
    const off = !tz ? -new Date(u).getTimezoneOffset() : tz === 'Z' ? 0 : (tz[0] === '-' ? -1 : 1) * (tz.slice(1, 3) * 60 + +tz.slice(4));
    const iso = new Date(u + off * 60000).toISOString(); // YYYY-MM-DDTHH:MM:SS.mmmZ, à l'heure du fuseau d'origine
    return iso.slice(0, 16) + (sec ? iso.slice(16, 19) : '') + (ms ? iso.slice(19, 23) : '') + (tz || '');
  }
  // Texte JSON → texte JSON décalé ; tout ce qui n'est pas du JSON passe tel quel.
  function convert(text, delta) {
    if (typeof text !== 'string' || !text) return text;
    try { return JSON.stringify(JSON.parse(text, (k, v) => (typeof v === 'string' ? shiftIso(v, delta) : v))); } catch { return text; }
  }
  const isApi = (u) => { try { return new URL(u, location.href).href.startsWith(cfg.api); } catch { return false; } };

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = input instanceof Request ? input.url : String(input);
    if (!isApi(url)) return origFetch.apply(this, arguments);
    if (typeof init?.body === 'string') init = { ...init, body: convert(init.body, cfg.skew) };
    const res = await origFetch.call(this, input, init);
    if (!/json/i.test(res.headers.get('content-type') || '')) return res;
    try {
      const out = new Response(convert(await res.clone().text(), -cfg.skew), { status: res.status, statusText: res.statusText, headers: res.headers });
      Object.defineProperty(out, 'url', { value: res.url });
      return out;
    } catch { return res; } // 204, etc.
  };

  // XHR (axios) : URL mémorisée à open(), corps envoyé décalé, réponse décalée à la lecture (mise en cache par requête).
  const P = XMLHttpRequest.prototype, open = P.open, send = P.send, tt = new WeakMap();
  P.open = function (method, url) { tt.set(this, isApi(url) ? {} : null); return open.apply(this, arguments); };
  P.send = function (body) { return send.call(this, tt.get(this) && typeof body === 'string' ? convert(body, cfg.skew) : body); };
  for (const p of ['responseText', 'response']) {
    const get = Object.getOwnPropertyDescriptor(P, p).get;
    Object.defineProperty(P, p, {
      configurable: true, enumerable: true,
      get() {
        const v = get.call(this), c = tt.get(this);
        if (!c || this.readyState !== 4 || !['', 'text', 'json'].includes(this.responseType)) return v;
        if (!(p in c)) c[p] = this.responseType === 'json' ? v && JSON.parse(convert(JSON.stringify(v), -cfg.skew)) : convert(v, -cfg.skew);
        return c[p];
      },
    });
  }
})();
