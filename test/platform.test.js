'use strict';
// SteamOS / handheld profiles: the right device, OS and tuning flags from real DMI + os-release values.
// SteamOS / 掌机配置：根据真实的 DMI 和 os-release 值得出正确的设备、系统和优化标志。
const test = require('node:test');
const assert = require('node:assert/strict');
require('../app/js/platform.js');
const { profileFor } = globalThis.PV.platform;

test('Steam Deck LCD vs OLED on SteamOS', () => {
  const lcd = profileFor({ osId: 'steamos', osIdLike: 'arch', vendor: 'Valve', product: 'Jupiter', board: 'Jupiter', gameMode: true });
  assert.equal(lcd.device, 'deck-lcd');
  assert.equal(lcd.os, 'SteamOS');
  assert.equal(lcd.oled, false);
  assert.ok(lcd.steamos && lcd.handheld && lcd.gamepad && lcd.gameMode);

  const oled = profileFor({ osId: 'steamos', vendor: 'Valve', product: 'Galileo', board: 'Galileo', gameMode: false });
  assert.equal(oled.device, 'deck-oled');
  assert.equal(oled.oled, true);
  assert.equal(oled.gameMode, false);
  assert.ok(oled.gamepad, 'handhelds get the gamepad UI in Desktop Mode too');
});

test('other handhelds and SteamOS-like distros', () => {
  const goS = profileFor({ osId: 'steamos', vendor: 'LENOVO', product: '83L3', productVersion: 'Legion Go S 8ARP1', board: 'LNVNB161216' });
  assert.equal(goS.device, 'legion-go-s');
  const go = profileFor({ osId: 'bazzite', osIdLike: 'fedora', vendor: 'LENOVO', product: '83E1', productVersion: 'Legion Go 8APU1' });
  assert.equal(go.device, 'legion-go');
  assert.equal(go.os, 'Bazzite');
  assert.ok(go.steamos);
  const ally = profileFor({ osId: 'chimeraos', vendor: 'ASUSTeK COMPUTER INC.', product: 'ROG Ally RC71L_RC71L', board: 'RC71L' });
  assert.equal(ally.device, 'rog-ally');
  assert.equal(ally.os, 'ChimeraOS');
});

test('desktop PCs are left alone unless in Gaming Mode', () => {
  const pc = profileFor({ osId: 'ubuntu', osName: 'Ubuntu 24.04 LTS', vendor: 'Dell Inc.', product: 'XPS 13 9340' });
  assert.deepEqual([pc.device, pc.steamos, pc.handheld, pc.gamepad, pc.oled], ['pc', false, false, false, false]);
  const htpc = profileFor({ osId: 'steamos', vendor: 'ASRock', product: 'DeskMini X600', gameMode: true });
  assert.deepEqual([htpc.device, htpc.steamos, htpc.handheld, htpc.gamepad], ['pc', true, false, true]);
  assert.equal(profileFor({}).device, 'pc');
  assert.equal(profileFor(null).gamepad, false);
});

test('Steam sets SteamDeck=1 even when DMI is unreadable', () => {
  assert.equal(profileFor({ steamDeck: true }).device, 'deck-lcd');
});
