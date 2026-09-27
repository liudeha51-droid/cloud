#!/usr/bin/env bash
# Startup smoke test: launch the desktop app on a virtual X display and make sure it opens its
# window and keeps running. Needs xvfb and x11-utils. Usage: smoke-linux.sh <path-to-binary>
# 启动冒烟测试：在虚拟 X 显示器上启动桌面应用，确认它能打开窗口并保持运行。
# 需要 xvfb 和 x11-utils。用法：smoke-linux.sh <可执行文件路径>
set -u
BIN="${1:?usage: smoke-linux.sh <path-to-binary>}"
WAIT="${SMOKE_WAIT:-30}"   # seconds to wait for the window / 等待窗口出现的秒数
LOG="$(mktemp)"

Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB=$!
export DISPLAY=:99
trap 'kill "$APP" "$XVFB" 2>/dev/null; rm -f "$LOG"' EXIT
for _ in $(seq 20); do xwininfo -root >/dev/null 2>&1 && break; sleep 0.5; done

"$BIN" >"$LOG" 2>&1 &
APP=$!

ok=""
for _ in $(seq "$WAIT"); do
  sleep 1
  if ! kill -0 "$APP" 2>/dev/null; then
    wait "$APP"; code=$?
    echo "::error::App exited during startup (exit code $code)"; cat "$LOG"; exit 1
  fi
  if xwininfo -root -tree | grep -q '"CloudVault"'; then ok=1; break; fi
done
if [ -z "$ok" ]; then
  echo "::error::No CloudVault window appeared within ${WAIT}s"; cat "$LOG"; exit 1
fi

# The window is up; make sure the app survives a few more seconds (e.g. loading the page).
# 窗口已出现；再观察几秒，确认应用没有崩溃（例如在加载页面时）。
sleep 5
if ! kill -0 "$APP" 2>/dev/null; then
  echo "::error::App crashed after opening its window"; cat "$LOG"; exit 1
fi
echo "CloudVault started and opened its window."
cat "$LOG"
