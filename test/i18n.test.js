'use strict';
// Every language must have exactly the same keys and {placeholders} as English,
// so no screen ever shows a raw key or a broken message.
// 每种语言的键和 {占位符} 都必须与英文完全一致，这样界面上永远不会出现原始键名或残缺的提示。
const test = require('node:test');
const assert = require('node:assert/strict');
require('../app/js/i18n.js');
const { STRINGS, LANGS, t, set, detect } = globalThis.PV.i18n;

const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');

test('offered languages', () => {
  assert.deepEqual(Object.keys(LANGS).sort(), ['de', 'en', 'es', 'fr', 'ko', 'ru', 'zh-CN', 'zh-TW']);
  assert.ok(!('ja' in LANGS), 'Japanese is intentionally not offered');
  assert.deepEqual(Object.keys(STRINGS).sort(), Object.keys(LANGS).sort());
});

for (const lang of Object.keys(STRINGS)) {
  test('complete translation: ' + lang, () => {
    const en = STRINGS.en, tr = STRINGS[lang];
    assert.deepEqual(Object.keys(tr).filter((k) => !(k in en)), [], 'extra keys');
    assert.deepEqual(Object.keys(en).filter((k) => !(k in tr)), [], 'missing keys');
    for (const k of Object.keys(en)) {
      assert.ok(typeof tr[k] === 'string' && tr[k].trim(), lang + '.' + k + ' is empty');
      assert.equal(placeholders(tr[k]), placeholders(en[k]), lang + '.' + k + ' placeholders differ');
    }
  });
}

test('t() interpolates and falls back', () => {
  set('zh-CN');
  assert.equal(t('all', { n: 3 }), '全部 3');
  assert.equal(t('err.VAULT_EXISTS', { user: 'bob' }).includes('bob'), true);
  set('de');
  assert.equal(t('unlock'), 'Entsperren');
  set('xx'); // unknown → English / 未知语言 → 英文
  assert.equal(t('unlock'), 'Unlock');
  assert.equal(t('no.such.key'), 'no.such.key');
});

test('detect() maps browser languages', () => {
  const nav = (langs) => { globalThis.navigator = { languages: langs }; return detect(); };
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: undefined });
    assert.equal(nav(['zh-CN']), 'zh-CN');
    assert.equal(nav(['zh-Hans-SG']), 'zh-CN');
    assert.equal(nav(['zh-TW']), 'zh-TW');
    assert.equal(nav(['zh-Hant-HK']), 'zh-TW');
    assert.equal(nav(['ko-KR']), 'ko');
    assert.equal(nav(['ja-JP', 'fr-FR']), 'fr'); // Japanese skipped / 跳过日语
    assert.equal(nav(['ja-JP']), 'en');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved);
  }
});
