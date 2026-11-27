/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOIM_API_URL?: string;
  readonly VITE_GOIM_WS_URL?: string;
  readonly VITE_GOIM_PLATFORM_ID?: string;
  readonly VITE_BUSINESS_API_URL?: string;
  readonly VITE_BUSINESS_API_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// 构建期注入的 package.json version（vite.config.ts 的 define）
declare const __APP_VERSION__: string;
declare const __SDK_VERSION__: string;
