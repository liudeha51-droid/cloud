// CloudVault personal AI — one-click actions backed by Claude or a local Ollama model.
//
// PRIVACY BOUNDARY: everything sent to a model goes through `redact()`. It emits only
// id, title, domain, tags, folder and *derived* password stats (length, strength label,
// reuse count, age). Passwords, usernames, full URLs and notes never leave the device.
(function (root) {
  'use strict';
  const C = root.PV.crypto;

  const DEFAULTS = {
    provider: 'anthropic',
    apiKey: '',
    model: 'claude-opus-5',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.1',
  };

  function domainOf(url) {
    if (!url) return '';
    try { return new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); }
    catch (e) { return ''; }
  }

  function redact(entries) {
    const reuse = new Map();
    for (const e of entries) if (e.password) reuse.set(e.password, (reuse.get(e.password) || 0) + 1);
    const now = Date.now();
    return entries.map((e) => {
      const s = C.strength(e.password);
      return {
        id: e.id,
        title: e.title || '',
        domain: domainOf(e.url),
        tags: e.tags || [],
        folder: e.folder || '',
        password: e.password
          ? { length: e.password.length, strength: s.label, reusedBy: reuse.get(e.password) - 1,
              ageDays: Math.floor((now - (e.pwChangedAt || e.createdAt || now)) / 86400000) }
          : null,
      };
    });
  }

  // ---------------- providers ----------------
  async function callAnthropic(cfg, system, prompt, schema) {
    if (!cfg.apiKey) throw new Error('Add your Anthropic API key in Settings → Personal AI');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        // Required for calls straight from a browser/webview. The key is the user's own and
        // lives only inside their encrypted vault — never on the sync server.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.model || DEFAULTS.model,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema } },
        fallbacks: 'default', // if a request is declined, the API retries it on a fallback model
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Claude: ' + ((data.error && data.error.message) || 'HTTP ' + res.status));
    if (data.stop_reason === 'refusal') throw new Error('Claude declined this request');
    if (data.stop_reason === 'max_tokens') throw new Error('Claude response was cut off — try fewer entries');
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return JSON.parse(text);
  }

  async function callOllama(cfg, system, prompt, schema) {
    const base = (cfg.ollamaUrl || DEFAULTS.ollamaUrl).replace(/\/+$/, '');
    let res;
    try {
      res = await fetch(base + '/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: cfg.ollamaModel || DEFAULTS.ollamaModel,
          stream: false,
          format: schema,
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        }),
      });
    } catch (e) {
      throw new Error('Cannot reach Ollama at ' + base + ' (is it running with OLLAMA_ORIGINS set? See README)');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Ollama: ' + (data.error || 'HTTP ' + res.status));
    return JSON.parse(data.message.content);
  }

  function call(cfg, system, prompt, schema) {
    cfg = Object.assign({}, DEFAULTS, cfg);
    return cfg.provider === 'ollama' ? callOllama(cfg, system, prompt, schema) : callAnthropic(cfg, system, prompt, schema);
  }

  const SYSTEM = 'You are the assistant built into CloudVault, a password manager. You only ever see redacted ' +
    'metadata (titles, domains, tags, folders, derived password statistics) - never actual secrets. ' +
    'Answer strictly in the requested JSON format.';

  function obj(properties) {
    return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
  }
  const str = { type: 'string' };
  const strArr = { type: 'array', items: str };

  // ---------------- one-click actions ----------------

  // Natural-language search: "the thing I pay taxes with" → matching entry ids.
  async function smartSearch(cfg, query, entries) {
    const r = await call(cfg, SYSTEM,
      'Vault items:\n' + JSON.stringify(redact(entries).map(({ id, title, domain, tags, folder }) => ({ id, title, domain, tags, folder }))) +
      '\n\nThe user is looking for: "' + query + '"\nReturn the ids of the items that best match, most relevant first ' +
      '(at most 10, empty if nothing fits), plus a one-sentence explanation.',
      obj({ ids: strArr, explanation: str }));
    const known = new Set(entries.map((e) => e.id));
    return { ids: (r.ids || []).filter((id) => known.has(id)), explanation: r.explanation || '' };
  }

  // Security audit on derived stats: weak, reused, old passwords, missing 2FA-capable services, etc.
  async function audit(cfg, entries) {
    const r = await call(cfg, SYSTEM,
      'Audit this vault for security risks. Consider weak or short passwords, reuse (reusedBy > 0), ' +
      'age over 365 days, and high-value accounts (email, banking, cloud, domain registrars) that deserve extra ' +
      'protection such as 2FA or passkeys. Prioritise the most important fixes.\n\n' + JSON.stringify(redact(entries)),
      obj({
        score: { type: 'integer', description: 'overall vault health 0-100' },
        summary: str,
        findings: {
          type: 'array',
          items: obj({ id: str, severity: { type: 'string', enum: ['high', 'medium', 'low'] }, issue: str, fix: str }),
        },
      }));
    return r;
  }

  // Suggest folders & tags for every item (applied only after the user confirms).
  async function organize(cfg, entries) {
    const r = await call(cfg, SYSTEM,
      'Suggest a tidy folder (one of a small, consistent set such as Email, Finance, Shopping, Social, Work, ' +
      'Dev, Entertainment, Travel, Utilities, Other - reuse existing folders where sensible) and 1-3 short ' +
      'lowercase tags for each item.\n\n' + JSON.stringify(redact(entries).map(({ id, title, domain, tags, folder }) => ({ id, title, domain, tags, folder }))),
      obj({ items: { type: 'array', items: obj({ id: str, folder: str, tags: strArr }) } }));
    return r.items || [];
  }

  // Fill in title/folder/tags for a single item from its URL/title.
  async function suggestFor(cfg, entry) {
    const [red] = redact([entry]);
    return call(cfg, SYSTEM,
      'Suggest a clean display title (the service name), a folder and 1-3 lowercase tags for this item:\n' +
      JSON.stringify({ title: red.title, domain: red.domain }),
      obj({ title: str, folder: str, tags: strArr }));
  }

  root.PV = root.PV || {};
  root.PV.ai = { DEFAULTS, redact, domainOf, smartSearch, audit, organize, suggestFor };
})(typeof window !== 'undefined' ? window : globalThis);
