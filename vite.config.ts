import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

// 开发期直接引用 SDK 源码，避免每次改动都要先构建 dist
const sdkEntry = fileURLToPath(
  new URL('../goim-sdk-js/src/index.ts', import.meta.url),
);

// 前端 app 版本（package.json）→ biz HTTP 头 X-Client-Version
const appPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string };

// goim SDK 版本（goim-sdk-js/package.json）→ goim WS 握手里的 sdkVersion
const sdkPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../goim-sdk-js/package.json', import.meta.url)), 'utf-8'),
) as { version: string };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_GOIM_API_PROXY || 'http://192.168.241.128:18880';
  const wsTarget = env.VITE_GOIM_WS_PROXY || 'ws://192.168.241.128:50001';
  const businessTarget = env.VITE_BUSINESS_API_PROXY || 'http://127.0.0.1:8080';

  return {
    plugins: [vue(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(appPkg.version),
      __SDK_VERSION__: JSON.stringify(sdkPkg.version),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@goim/web-sdk': sdkEntry,
      },
    },
    server: {
      port: 5173,
      // SDK 在父目录，需要放开文件访问范围
      fs: { allow: ['..'] },
      // 转发到联调服务，绕开浏览器 CORS
      proxy: {
        // goim-api 的 HTTP 前缀同样是 /api/v1，原样转发
        '/api/v1': { target: apiTarget, changeOrigin: true },
        '/ws': { target: wsTarget, ws: true, changeOrigin: true },
        // 业务后端真实路径就是 /biz-api/v1，直接原样转发
        '/biz-api': {
          target: businessTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
