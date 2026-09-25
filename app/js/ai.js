// CloudVault personal AI — one-click actions backed by Claude or a local Ollama model.
// CloudVault 个人 AI —— 一键操作，可使用 Claude 或本地 Ollama 模型。
//
// PRIVACY BOUNDARY: everything sent to a model goes through `redact()`. It emits only
// id, title, domain, tags, folder and *derived* password stats (length, strength label,
// reuse count, age). Passwords, usernames, full URLs and notes never leave the device.
// 隐私边界：发送给模型的所有数据都必须经过 `redact()`。它只输出
// id、标题、域名、标签、文件夹，以及*推导出的*密码统计（长度、强度、重复使用次数、使用天数）。
// 密码、用户名、完整网址和备注永远不会离开设备。
(function (root) {
  'use strict';
  const C = root.PV.crypto;

  const DEFAULTS = {
    provider: 'anthropic',
    apiKey: '',
    model: 'claude-opus-5',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'llama3.1',
    language: 'English', // language for human-readable AI output / AI 输出文字所用的语言
  };

  // Errors carry a `code` so the UI can translate them (see i18n.js "err.*").
  // 错误带有 `code`，便于界面翻译（见 i18n.js 中的 "err.*"）。
  function fail(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  function domainOf(url) {
    if (!url) return '';
    try { return new URL(/^[a-z]+:\/\//i.test(url) ? url : 'https://' + url).hostname.replace(/^www\./, ''); }
    catch (e) { return ''; }
  }

  // The ONLY function that prepares vault data for AI. / 唯一一个为 AI 准备密码库数据的函数。
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

  // ---------------- providers / 模型提供方 ----------------
  async function callAnthropic(cfg, system, prompt, schema) {
    if (!cfg.apiKey) throw fail('NO_KEY', 'Add your Anthropic API key in Settings → Personal AI');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        // Required for calls straight from a browser/webview. The key is the user's own and
        // lives only inside their encrypted vault — never on the sync server.
        // 从浏览器/WebView 直接调用时必须加这个请求头。密钥属于用户本人，
        // 只保存在其加密密码库中——绝不会放到同步服务器上。
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: cfg.model || DEFAULTS.model,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema } },
        // if a request is declined, the API retries it on a fallback model / 如果请求被拒绝，API 会自动换用备用模型重试
        fallbacks: 'default',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Claude: ' + ((data.error && data.error.message) || 'HTTP ' + res.status));
    if (data.stop_reason === 'refusal') throw fail('REFUSED', 'Claude declined this request');
    if (data.stop_reason === 'max_tokens') throw fail('CUT_OFF', 'Claude response was cut off — try fewer entries');
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
          format: schema, // Ollama constrains output to this JSON schema / Ollama 会按此 JSON Schema 约束输出
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        }),
      });
    } catch (e) {
      throw fail('OLLAMA', 'Cannot reach Ollama at ' + base + ' (is it running with OLLAMA_ORIGINS set? See README)');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('Ollama: ' + (data.error || 'HTTP ' + res.status));
    return JSON.parse(data.message.content);
  }

  // Adds the answer-language instruction, then dispatches to the configured provider.
  // 加上“用哪种语言回答”的指令，然后交给配置的提供方处理。
  function call(cfg, system, prompt, schema) {
    cfg = Object.assign({}, DEFAULTS, cfg);
    system += ' Write every human-readable string (explanations, summaries, issues, fixes, folder names, tags) in ' +
      cfg.language + '. Keep brand and service names (e.g. Gmail, GitHub) as they are. Never translate ids.';
    return cfg.provider === 'ollama' ? callOllama(cfg, system, prompt, schema) : callAnthropic(cfg, system, prompt, schema);
  }

  const SYSTEM = 'You are the assistant built into CloudVault, a password manager. You only ever see redacted ' +
    'metadata (titles, domains, tags, folders, derived password statistics) - never actual secrets. ' +
    'Answer strictly in the requested JSON format.';

  // JSON Schema helpers / JSON Schema 辅助函数
  function obj(properties) {
    return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
  }
  const str = { type: 'string' };
  const strArr = { type: 'array', items: str };

  // ---------------- one-click actions / 一键操作 ----------------

  // Natural-language search: "the thing I pay taxes with" → matching entry ids.
  // 自然语言搜索：“我交税用的那个” → 匹配的条目 id。
  async function smartSearch(cfg, query, entries) {
    const r = await call(cfg, SYSTEM,
      'Vault items:\n' + JSON.stringify(redact(entries).map(({ id, title, domain, tags, folder }) => ({ id, title, domain, tags, folder }))) +
      '\n\nThe user is looking for: "' + query + '"\nReturn the ids of the items that best match, most relevant first ' +
      '(at most 10, empty if nothing fits), plus a one-sentence explanation.',
      obj({ ids: strArr, explanation: str }));
    // Ignore any id the model made up. / 忽略模型编造的 id。
    const known = new Set(entries.map((e) => e.id));
    return { ids: (r.ids || []).filter((id) => known.has(id)), explanation: r.explanation || '' };
  }

  // Security audit on derived stats: weak, reused, old passwords, missing 2FA-capable services, etc.
  // 基于统计信息的安全检查：弱密码、重复使用、长期未改、重要账户缺少双重验证等。
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
  // 为每个条目推荐文件夹和标签（用户确认后才会应用）。
  async function organize(cfg, entries) {
    const r = await call(cfg, SYSTEM,
      'Suggest a tidy folder (one of a small, consistent set such as Email, Finance, Shopping, Social, Work, ' +
      'Dev, Entertainment, Travel, Utilities, Other - reuse existing folders where sensible) and 1-3 short ' +
      'lowercase tags for each item.\n\n' + JSON.stringify(redact(entries).map(({ id, title, domain, tags, folder }) => ({ id, title, domain, tags, folder }))),
      obj({ items: { type: 'array', items: obj({ id: str, folder: str, tags: strArr }) } }));
    return r.items || [];
  }

  // Fill in title/folder/tags for a single item from its URL/title.
  // 根据网址或标题，为单个条目补全标题、文件夹和标签。
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
