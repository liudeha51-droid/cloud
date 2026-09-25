'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../app/js/fuzzy.js');
const { search, editDistance } = globalThis.PV.fuzzy;

const entries = [
  { id: 1, title: 'Gmail', url: 'https://mail.google.com', username: 'me@gmail.com', tags: ['email'], folder: 'Email' },
  { id: 2, title: 'Amazon', url: 'amazon.com', username: 'shopper', tags: ['shopping'], folder: 'Shopping' },
  { id: 3, title: 'Chase Bank', url: 'chase.com', username: 'jdoe', tags: ['finance'], folder: 'Finance' },
  { id: 4, title: 'Netflix', url: 'netflix.com', username: 'movies@example.com', tags: [], folder: 'Entertainment' },
  { id: 5, title: 'GitHub', url: 'github.com', username: 'octocat', tags: ['dev'], folder: 'Dev' },
  { id: 6, title: 'Café Rewards', url: 'cafe.example', username: 'coffee', tags: [], folder: '' },
];
const top = (q) => (search(entries, q)[0] || {}).entry?.title;
const ids = (q) => search(entries, q).map((r) => r.entry.id);

test('exact and prefix', () => {
  assert.equal(top('gmail'), 'Gmail');
  assert.equal(top('git'), 'GitHub');
  assert.equal(top('net'), 'Netflix');
});

test('typos', () => {
  assert.equal(top('gmial'), 'Gmail');   // transposition
  assert.equal(top('amazn'), 'Amazon');  // deletion
  assert.equal(top('netflx'), 'Netflix');
  assert.equal(top('githib'), 'GitHub'); // substitution
  assert.equal(top('chsae'), 'Chase Bank');
});

test('abbreviation / subsequence', () => {
  assert.equal(top('amzn'), 'Amazon');
  assert.equal(top('nflx'), 'Netflix');
});

test('multi-word AND, any order, across fields', () => {
  assert.deepEqual(ids('bank chase'), [3]);
  assert.equal(top('finance jdoe'), 'Chase Bank');
  assert.deepEqual(ids('chase netflix'), []);
});

test('accents and punctuation', () => {
  assert.equal(top('cafe'), 'Café Rewards');
  assert.equal(top('mail.google'), 'Gmail');
});

test('empty query returns everything, nonsense returns nothing', () => {
  assert.equal(search(entries, '').length, entries.length);
  assert.equal(search(entries, 'zzqxw').length, 0);
});

test('short words are not typo-matched (avoids noise)', () => {
  assert.deepEqual(ids('dvx'), []);
});

test('editDistance', () => {
  assert.equal(editDistance('gmial', 'gmail', 2), 1);
  assert.equal(editDistance('kitten', 'sitting', 5), 3);
  assert.equal(editDistance('abc', 'abcdefgh', 2), 3); // early exit returns max+1
});
