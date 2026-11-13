import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

// 开发期直接引用 SDK 源码，避免每次改动都要先构建 dist
const sdkEntry = fileURLToPath(
  new URL('../goim-sdk-js/src/index.ts', import.meta.url),
);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_GOIM_API_PROXY || 'http://192.168.241.128:18880';
  const wsTarget = env.VITE_GOIM_WS_PROXY || 'ws://192.168.241.128:50001';

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@goim/web-sdk': sdkEntry,
      },
    },
    server: {
      port: 5173,
      // SDK 在父目录，需要放开文件访问范围
      fs: { allow: ['..'] },
      // 转发到联调服务，绕开浏览器 CORS
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/ws': { target: wsTarget, ws: true, changeOrigin: true },
      },
    },
  };
});
