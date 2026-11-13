#!/usr/bin/env bash
# 把 goim-sdk-js/wasm 产物同步到本项目的 public/wasm
# 用法：bash scripts/copy-wasm.sh（dev/build 前自动执行）
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_root="$(dirname "$script_dir")"
src="$(dirname "$app_root")/goim-sdk-js/wasm"
dst="$app_root/public/wasm"

if [ ! -d "$src" ]; then
    echo "未找到 wasm 产物目录：$src，请先在 goim-sdk-js 执行 npm run build:wasm" >&2
    exit 1
fi

mkdir -p "$dst"

for name in goim.wasm wasm_exec.js idb_wrapper.js manifest.json; do
    if [ -f "$src/$name" ]; then
        cp -f "$src/$name" "$dst/$name"
    fi
done

echo "wasm 资源已同步 -> $dst"
