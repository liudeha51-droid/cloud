// CloudVault gamepad navigation — for Steam Gaming Mode and PC handhelds.
// CloudVault 手柄导航 —— 用于 Steam 游戏模式和 PC 掌机。
//
// Works with both ways Steam Input can present the controller:
//   • "Gamepad" layout  → Gamepad API (standard / Xbox mapping)
//   • "Web browser" / keyboard layouts → arrow keys, Enter, Escape
// 支持 Steam Input 呈现控制器的两种方式：
//   • “手柄”布局 → Gamepad API（标准 / Xbox 映射）
//   • “网页浏览器”/键盘布局 → 方向键、Enter、Escape
//
//   D-pad / left stick  move focus        方向键/左摇杆  移动焦点
//   A                   select            A             选择
//   B                   back / close      B             返回/关闭
//   X                   search + keyboard X             搜索 + 键盘
//   Y                   copy password     Y             复制密码
//   LB / RB             previous/next folder            上一个/下一个文件夹
//   View (⧉)            lock              视图键         锁定
//   Start (☰)           settings          菜单键         设置
//   Right stick         scroll            右摇杆         滚动
(function (root) {
  'use strict';
  const doc = root.document;
  if (!doc) return;
  const { platform, i18n } = root.PV;
  const t = i18n.t;
  const $ = (id) => doc.getElementById(id);

  const FOCUSABLE = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, label.button, [tabindex]:not([tabindex="-1"])';
  const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, VIEW: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
  const REPEAT_DELAY = 380, REPEAT_EVERY = 110, STICK = 0.55;

  // Last input source: 'pad' | 'touch' | 'mouse' | 'key'. / 最近的输入方式。
  let lastInput = 'mouse';

  function visible(el) {
    if (el.disabled || el.closest('[hidden]') || el.closest('[inert]')) return false;
    if (el.closest('details:not([open])') && el.tagName !== 'SUMMARY') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  // The top-most open dialog traps focus; otherwise the whole page. / 最上层打开的对话框限制焦点范围；否则为整个页面。
  function scope() {
    const open = doc.querySelectorAll('dialog[open]');
    return open.length ? open[open.length - 1] : doc.body;
  }
  function candidates() {
    return Array.from(scope().querySelectorAll(FOCUSABLE)).filter(visible);
  }
  function isText(el) {
    return !!el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|file|color)$/i.test(el.type)));
  }

  function focusEl(el) {
    doc.documentElement.dataset.padnav = '';
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Spatial navigation: nearest focusable in the pressed direction, preferring ones in line with the current one.
  // 空间导航：选择按下方向上最近的可聚焦元素，优先选择与当前元素对齐的。
  function move(dir) {
    const list = candidates();
    if (!list.length) return;
    const cur = doc.activeElement;
    if (!cur || cur === doc.body || !list.includes(cur)) { focusEl(list[0]); return; }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      let main, cross;
      if (dir === 'down' || dir === 'up') {
        main = dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
        if ((dir === 'down' ? by - ay : ay - by) <= 1) continue;
        cross = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
        if (cross === 0) cross = Math.abs(bx - ax) / 8; // overlapping columns: slight preference for aligned / 列重叠时略微偏好对齐的
      } else {
        main = dir === 'right' ? b.left - a.right : a.left - b.right;
        if ((dir === 'right' ? bx - ax : ax - bx) <= 1) continue;
        cross = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
        if (cross === 0) cross = Math.abs(by - ay) / 8;
      }
      const score = Math.max(0, main) + cross * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) focusEl(best);
    else if (dir === 'up' || dir === 'down') scrollBy(dir === 'down' ? 160 : -160);
  }

  function scrollBy(dy) {
    let el = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : $('list');
    while (el && el !== doc.body) {
      if (el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) break;
      el = el.parentElement;
    }
    (el && el !== doc.body ? el : doc.scrollingElement).scrollBy({ top: dy });
  }

  function activate() {
    const el = doc.activeElement;
    if (!el || el === doc.body) { move('down'); return; }
    if (isText(el)) { platform.steamKeyboard(); return; }
    if (el.tagName === 'SELECT') { // no native picker from a gamepad: cycle options / 手柄无法打开原生下拉框：循环切换选项
      el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    el.click();
  }

  function back() {
    const open = doc.querySelectorAll('dialog[open]');
    if (open.length) { open[open.length - 1].close(); return; }
    const backBtn = doc.querySelector('#detail .back');
    if (backBtn && backBtn.getBoundingClientRect().width > 0) { backBtn.click(); return; }
    const q = $('q');
    if (q && !$('app').hidden && (q.value || doc.activeElement !== q)) {
      q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      focusEl(q);
    }
  }

  function unlocked() { return !$('app').hidden; }
  function clickIfShown(id) { const b = $(id); if (b && visible(b)) b.click(); }

  function cycleFolder(step) {
    const chips = Array.from(doc.querySelectorAll('#folders button'));
    if (!chips.length || $('folders').hidden) return;
    const i = chips.findIndex((c) => c.getAttribute('aria-pressed') === 'true');
    const next = chips[(i + step + chips.length) % chips.length];
    next.click();
  }

  function press(btn) {
    lastInput = 'pad';
    const dialog = doc.querySelector('dialog[open]');
    switch (btn) {
      case BTN.UP: return move('up');
      case BTN.DOWN: return move('down');
      case BTN.LEFT: return move('left');
      case BTN.RIGHT: return move('right');
      case BTN.A: return activate();
      case BTN.B: return back();
      case BTN.X: {
        const target = unlocked() && !dialog ? $('q') : (isText(doc.activeElement) ? doc.activeElement : null);
        if (target) focusEl(target);
        platform.steamKeyboard();
        return;
      }
      case BTN.Y: if (unlocked() && !dialog) doc.dispatchEvent(new CustomEvent('cloudvault:copy-password')); return;
      case BTN.LB: if (unlocked() && !dialog) cycleFolder(-1); return;
      case BTN.RB: if (unlocked() && !dialog) cycleFolder(1); return;
      case BTN.VIEW: if (unlocked()) clickIfShown('btnLock'); return;
      case BTN.START: if (unlocked() && !dialog) clickIfShown('btnSettings'); return;
    }
  }

  // ---------- Gamepad API polling / Gamepad API 轮询 ----------
  const held = new Map(); // key → { since, last } / 按键 → 按下时间、上次触发时间
  const REPEATS = new Set([BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT]);
  let polling = false;

  function pads() {
    try { return Array.from(root.navigator.getGamepads ? root.navigator.getGamepads() : []).filter(Boolean); } catch (e) { return []; }
  }

  function poll(now) {
    const list = pads();
    if (!list.length) { polling = false; held.clear(); return; }
    const down = new Set();
    let scroll = 0;
    for (const p of list) {
      p.buttons.forEach((b, i) => { if (b && (b.pressed || b.value > 0.5)) down.add(i); });
      const [lx = 0, ly = 0, , ry = 0] = p.axes;
      if (ly < -STICK) down.add(BTN.UP);
      if (ly > STICK) down.add(BTN.DOWN);
      if (lx < -STICK) down.add(BTN.LEFT);
      if (lx > STICK) down.add(BTN.RIGHT);
      if (Math.abs(ry) > 0.25) scroll = ry;
    }
    if (doc.hasFocus()) {
      for (const b of down) {
        const h = held.get(b);
        if (!h) { held.set(b, { since: now, last: now }); press(b); }
        else if (REPEATS.has(b) && now - h.since > REPEAT_DELAY && now - h.last > REPEAT_EVERY) { h.last = now; press(b); }
      }
      if (scroll) scrollBy(scroll * 18);
    }
    for (const b of Array.from(held.keys())) if (!down.has(b)) held.delete(b);
    root.requestAnimationFrame(poll);
  }
  function startPolling() {
    if (polling) return;
    polling = true;
    showHints();
    root.requestAnimationFrame(poll);
  }
  root.addEventListener('gamepadconnected', startPolling);
  if (pads().length) startPolling();

  // ---------- keyboard-mapped controllers / 映射为键盘的控制器 ----------
  const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  doc.addEventListener('keydown', (e) => {
    lastInput = 'key';
    if (!platform.profile.gamepad || e.altKey || e.ctrlKey || e.metaKey) return;
    const dir = ARROWS[e.key];
    if (!dir) return;
    const el = e.target;
    // Leave arrows alone where they edit a value (text caret, sliders, dropdowns).
    // 在方向键用于编辑的地方（文本光标、滑块、下拉框）不拦截。
    if (el.tagName === 'SELECT' || el.type === 'range' || el.type === 'number' || el.tagName === 'TEXTAREA') return;
    if (isText(el) && (dir === 'left' || dir === 'right')) return;
    e.preventDefault();
    move(dir);
  }, true);
  doc.addEventListener('pointerdown', (e) => {
    lastInput = e.pointerType === 'touch' ? 'touch' : 'mouse';
    if (lastInput === 'mouse') delete doc.documentElement.dataset.padnav;
  }, { passive: true, capture: true });

  // Gaming Mode has no keyboard for non-Steam apps: open Steam's when a text field is tapped or selected by pad.
  // 游戏模式下非 Steam 应用没有键盘：用触摸或手柄选中文本框时打开 Steam 键盘。
  doc.addEventListener('focusin', (e) => {
    if (platform.profile.gameMode && isText(e.target) && (lastInput === 'touch' || lastInput === 'pad')) platform.steamKeyboard();
  });

  // ---------- on-screen button hints / 屏幕按键提示 ----------
  let bar = null;
  function renderHints() {
    if (!bar) return;
    const hint = (glyph, key) => {
      const s = doc.createElement('span');
      const g = doc.createElement('b');
      g.className = 'glyph';
      g.textContent = glyph;
      s.append(g, ' ' + t(key));
      return s;
    };
    bar.replaceChildren(hint('A', 'pad.select'), hint('B', 'pad.back'), hint('X', 'pad.search'),
      hint('Y', 'pad.copyPw'), hint('LB RB', 'pad.folder'), hint('⧉', 'pad.lock'));
  }
  function showHints() {
    if (!bar) {
      bar = doc.createElement('footer');
      bar.className = 'pad-hints';
      bar.setAttribute('aria-hidden', 'true');
      doc.body.append(bar);
      i18n.onChange(renderHints);
    }
    renderHints();
    doc.documentElement.dataset.padhints = '';
  }
  platform.onChange((p) => { if (p.gameMode) showHints(); });
  if (platform.profile.gameMode) showHints();

  root.PV.gamepad = { move, press, BTN };
})(typeof window !== 'undefined' ? window : globalThis);
