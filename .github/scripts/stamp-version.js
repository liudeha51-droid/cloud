// Write the release version (from the git tag) into the app before building, so installers,
// "About" info and Android versionCode match the tag instead of whatever was last committed.
// 构建前把发布版本号（来自 git 标签）写入应用，让安装包、“关于”信息和 Android versionCode
// 与标签一致，而不是最后一次提交时的版本号。
//
// Usage / 用法: node .github/scripts/stamp-version.js 0.2.0-beta.1
// Only the numeric x.y.z part is written: Windows .msi (WiX) rejects pre-release suffixes.
// 只写入数字部分 x.y.z：Windows .msi（WiX）不接受预发布后缀。
'use strict';
const fs = require('fs');
const path = require('path');

const full = String(process.argv[2] || '').replace(/^v/, '');
const m = /^(\d+)\.(\d+)\.(\d+)/.exec(full);
if (!m) {
  console.error('Not a version: "' + full + '" (expected x.y.z…)');
  process.exit(1);
}
const version = m[0];
const root = path.join(__dirname, '..', '..');

function edit(rel, fn) {
  const file = path.join(root, rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after === before && !before.includes(version)) throw new Error('version not found in ' + rel);
  fs.writeFileSync(file, after);
  console.log(rel + ' → ' + version);
}

edit('src-tauri/tauri.conf.json', (s) => {
  const j = JSON.parse(s);
  j.version = version;
  return JSON.stringify(j, null, 2) + '\n';
});
edit('package.json', (s) => {
  const j = JSON.parse(s);
  j.version = version;
  return JSON.stringify(j, null, 2) + '\n';
});
// First `version = "…"` in Cargo.toml is the [package] one. / Cargo.toml 中第一个 version 就是 [package] 的版本。
edit('src-tauri/Cargo.toml', (s) => s.replace(/^version = "[^"]*"/m, 'version = "' + version + '"'));
