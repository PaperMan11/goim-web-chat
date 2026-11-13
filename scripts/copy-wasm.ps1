# 把 goim-sdk-js/wasm 产物同步到本项目的 public/wasm
# 用法：npm run copy:wasm（dev/build 前自动执行）
$ErrorActionPreference = 'Stop'

$appRoot = Split-Path -Parent $PSScriptRoot            # goim-web-chat/
$src = Join-Path (Split-Path -Parent $appRoot) 'goim-sdk-js/wasm'
$dst = Join-Path $appRoot 'public/wasm'

if (-not (Test-Path $src)) {
    throw "未找到 wasm 产物目录：$src，请先在 goim-sdk-js 执行 npm run build:wasm"
}
New-Item -ItemType Directory -Force -Path $dst | Out-Null

foreach ($name in @('goim.wasm', 'wasm_exec.js', 'idb_wrapper.js', 'manifest.json')) {
    $file = Join-Path $src $name
    if (Test-Path $file) {
        Copy-Item $file $dst -Force
    }
}
Write-Host "wasm 资源已同步 -> $dst"
