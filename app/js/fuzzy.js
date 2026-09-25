// CloudVault fuzzy search — typo-tolerant, multi-word, field-weighted.
//
// Every query word must match *something* in the entry (AND semantics). Each word is
// scored against every word of every field, best match wins:
//   exact 1.0 > prefix 0.9 > substring 0.75 > typo (Damerau-Levenshtein) 0.7/0.5 > subsequence ≤0.6
// e.g. "gmial" → Gmail, "amzn" → Amazon, "bank chase" → "Chase Bank", "nflx" → Netflix.
(function (root) {
  'use strict';

  const FIELDS = [
    { key: 'title', weight: 3 },
    { key: 'url', weight: 2 },
    { key: 'username', weight: 2 },
    { key: 'tags', weight: 1.5 },
    { key: 'folder', weight: 1.2 },
    { key: 'notes', weight: 0.6 },
  ];

  function normalize(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents: "café" → "cafe"
      .toLowerCase();
  }
  function words(s) {
    return normalize(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  // Optimal string alignment distance with early exit once it exceeds `max`.
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
  function subsequence(q, w) {
    if (q.length < 2 || q[0] !== w[0]) return 0;
    let i = 0;
    for (let j = 0; j < w.length && i < q.length; j++) if (w[j] === q[i]) i++;
    return i === q.length ? q.length / w.length : 0;
  }

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
        if (q.length >= 3 && f.text.includes(q)) s = 0.8; // spans punctuation, e.g. "gmail.com"
        for (const w of f.words) {
          if (s === 1) break;
          s = Math.max(s, scoreWord(q, w));
        }
        best = Math.max(best, s * f.weight);
      }
      if (best === 0) return 0; // every query word must match
      total += best;
    }
    return total / (queryWords.length * FIELDS[0].weight);
  }

  // entries: array of objects; returns [{ entry, score }] best first. Empty query → everything.
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
