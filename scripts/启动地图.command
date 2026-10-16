#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo '请先安装 Node.js 20 或更新版本，然后重新启动。'
  exit 1
fi
LBS_OPEN_BROWSER=1 npm start
