/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOIM_API_URL?: string;
  readonly VITE_GOIM_WS_URL?: string;
  readonly VITE_GOIM_PLATFORM_ID?: string;
  readonly VITE_GOIM_ADMIN_USER_ID?: string;
  readonly VITE_GOIM_ADMIN_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
