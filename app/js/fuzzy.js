// CloudVault fuzzy search — typo-tolerant, multi-word, field-weighted.
//
// Every query word must match *something* in the entry (AND semantics). Each word is
// scored against every word of every field, best match wins:
//   exact 1.0 > prefix 0.9 > substring 0.75 > typo (Damerau-Levenshtein) 0.7/0.5 > subsequence ≤0.6
// e.g. "gmial" → Gmail, "amzn" → Amazon, "bank chase" → "Chase Bank", "nflx" → Netflix.
//
// CloudVault 模糊搜索 —— 容错（允许错别字）、支持多个关键词、按字段加权。
// 每个查询词都必须在条目中匹配到某处（“与”逻辑）。每个词会和每个字段里的每个词比较，取最高分：
//   完全相同 1.0 > 前缀 0.9 > 包含 0.75 > 错别字（Damerau-Levenshtein 距离）0.7/0.5 > 子序列 ≤0.6
// 例如 "gmial" → Gmail、"amzn" → Amazon、"bank chase" → "Chase Bank"、"银行" → "招商银行"。
(function (root) {
  'use strict';

  // Field weights: a title match counts most, notes least. / 字段权重：标题匹配最重要，备注最不重要。
  const FIELDS = [
    { key: 'title', weight: 3 },
    { key: 'url', weight: 2 },
    { key: 'username', weight: 2 },
    { key: 'tags', weight: 1.5 },
    { key: 'folder', weight: 1.2 },
    { key: 'notes', weight: 0.6 },
  ];

  // Lower-case and strip accents so "café" matches "cafe". / 转小写并去掉重音符号，使 "café" 能匹配 "cafe"。
  function normalize(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents: "café" → "cafe"
      .toLowerCase();
  }
  // Split into words on anything that is not a letter or digit (CJK text stays one word and is
  // matched by substring). / 按非字母、非数字的字符切分单词（中日韩文字连成一个词，靠“包含”匹配）。
  function words(s) {
    return normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  // Optimal string alignment distance with early exit once it exceeds `max`.
  // 最优字符串对齐距离（允许相邻字符交换），一旦超过 `max` 就提前退出。
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const prev2 = new Array(b.length + 1);
    let prev = new Array(b.length + 1);
    let cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
      const t = prev; prev = cur; cur = t;
    }
    return prev[b.length];
  }

  // Characters of q appear in w in order ("amzn" in "amazon"). Returns 0..1 density or 0.
  // q 的字符按顺序出现在 w 中（如 "amzn" 之于 "amazon"）。返回 0..1 的密度，不匹配返回 0。
  function subsequence(q, w) {
    if (q.length < 2 || q[0] !== w[0]) return 0;
    let i = 0;
    for (let j = 0; j < w.length && i < q.length; j++) if (w[j] === q[i]) i++;
    return i === q.length ? q.length / w.length : 0;
  }

  // Typos tolerated: none for short words, which would otherwise match almost everything.
  // 允许的错别字数：短词不允许，否则几乎什么都能匹配上。
  function maxTypos(len) {
    return len <= 3 ? 0 : len <= 6 ? 1 : 2;
  }

  function scoreWord(q, w) {
    if (w === q) return 1;
    if (w.startsWith(q)) return 0.9;
    if (q.length >= 2 && w.includes(q)) return 0.75;
    const max = maxTypos(q.length);
    if (max) {
      let d = editDistance(q, w, max);
      // Also compare against the start of a longer word, so a typo while still typing works: "gogl" → "google"
      // 同时与较长单词的开头比较，这样边输入边打错也能匹配："gogl" → "google"
      if (d > max && w.length > q.length) d = editDistance(q, w.slice(0, q.length), max);
      if (d <= max) return d === 1 ? 0.7 : 0.5;
    }
    const s = subsequence(q, w);
    return s ? 0.35 + 0.25 * s : 0;
  }

  function prepare(entry) {
    return FIELDS.map((f) => {
      const raw = Array.isArray(entry[f.key]) ? entry[f.key].join(' ') : entry[f.key];
      return { weight: f.weight, text: normalize(raw), words: words(raw) };
    });
  }

  function scoreEntry(queryWords, prepared) {
    let total = 0;
    for (const q of queryWords) {
      let best = 0;
      for (const f of prepared) {
        let s = 0;
        if (q.length >= 3 && f.text.includes(q)) s = 0.8; // spans punctuation, e.g. "gmail.com" / 可跨标点匹配，如 "gmail.com"
        for (const w of f.words) {
          if (s === 1) break;
          s = Math.max(s, scoreWord(q, w));
        }
        best = Math.max(best, s * f.weight);
      }
      if (best === 0) return 0; // every query word must match / 每个查询词都必须匹配
      total += best;
    }
    return total / (queryWords.length * FIELDS[0].weight);
  }

  // entries: array of objects; returns [{ entry, score }] best first. Empty query → everything.
  // entries：对象数组；返回按得分从高到低排序的 [{ entry, score }]。查询为空时返回全部。
  function search(entries, query, opts) {
    const minScore = (opts && opts.minScore) || 0.1;
    const qWords = words(query);
    if (!qWords.length) return entries.map((entry) => ({ entry, score: 0 }));
    const out = [];
    for (const entry of entries) {
      const score = scoreEntry(qWords, prepare(entry));
      if (score >= minScore) out.push({ entry, score });
    }
    out.sort((a, b) => b.score - a.score || String(a.entry.title).localeCompare(String(b.entry.title)));
    return out;
  }

  root.PV = root.PV || {};
  root.PV.fuzzy = { search, editDistance, scoreWord, words };
})(typeof window !== 'undefined' ? window : globalThis);
