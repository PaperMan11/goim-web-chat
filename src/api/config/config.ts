// 客户端启动配置，与 goim-business internal/handler/clientconfig 对应。
// 支持 ETag 条件请求：命中 304 时直接返回 localStorage 缓存，不重复拉取配置体。

import { BusinessApiError } from '../client';
import { http, normalizeError, unwrapEnvelope } from '../http';

export interface ClientConfigIM {
  apiBaseUrl: string;
  wsUrl: string;
  platformId: number;
}

// openapi ClientConfigResponse
export interface ClientConfigResponse {
  configVersion: number;
  features: Record<string, boolean>;
  im: ClientConfigIM;
  limits: Record<string, number>;
  minAppVersion: Record<string, string>;
}

// openapi ClientConfigItemSchema
export interface ClientConfigItemSchema {
  key: string;
  type: 'bool' | 'int64' | 'string';
  default?: unknown;
  scope: string;
}

// openapi ClientConfigSchemaResponse
export interface ClientConfigSchemaResponse {
  items: ClientConfigItemSchema[];
}

const PLATFORM = 'web';
// 缓存格式版本，结构变化时递增以丢弃旧缓存
const CACHE_VERSION = 1;
const CONFIG_TTL = 24 * 60 * 60 * 1000; // 配置 24h 内走条件请求，超过则全量拉取
const SCHEMA_TTL = 7 * 24 * 60 * 60 * 1000; // 配置项元数据基本不变，缓存 7 天
const CONFIG_KEY = `goim_biz_client_config_${PLATFORM}`;
const SCHEMA_KEY = 'goim_biz_client_config_schema';

interface ConfigCache {
  cacheVersion: number;
  platform: string;
  etag: string;
  config: ClientConfigResponse;
  fetchedAt: number;
}

interface SchemaCache {
  cacheVersion: number;
  schema: ClientConfigSchemaResponse;
  fetchedAt: number;
}

function readStorage<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage 不可用时退化为每次全量拉取
  }
}

// ———— 配置本体 ————

let configInflight: Promise<ClientConfigResponse> | undefined;

// force=true 跳过条件请求，强制全量拉取（设置页手动刷新用）
export function getClientConfig(force = false): Promise<ClientConfigResponse> {
  if (!configInflight) {
    configInflight = fetchConfig(force, false).finally(() => {
      configInflight = undefined;
    });
  }
  return configInflight;
}

async function fetchConfig(force: boolean, retried: boolean): Promise<ClientConfigResponse> {
  const cached = readStorage<ConfigCache>(CONFIG_KEY);
  const usable =
    cached && cached.cacheVersion === CACHE_VERSION && cached.platform === PLATFORM
      ? cached
      : undefined;
  const conditional =
    usable && !force && Date.now() - usable.fetchedAt <= CONFIG_TTL && usable.etag;

  let response;
  try {
    response = await http.request({
      url: '/client-config',
      method: 'GET',
      params: { platform: PLATFORM },
      headers: conditional
        ? // no-cache 强制协商，避免浏览器直接用本地 HTTP 缓存
          { 'If-None-Match': usable!.etag, 'Cache-Control': 'no-cache' }
        : {},
      // 仅本接口放行 304，其它请求仍按 axios 默认校验
      validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
    });
  } catch (err) {
    throw normalizeError(err);
  }

  if (response.status === 304) {
    if (usable) {
      // 服务端确认未变化：刷新缓存时间，避免 TTL 到期后重复全量拉取
      writeStorage(CONFIG_KEY, { ...usable, fetchedAt: Date.now() });
      return usable.config;
    }
    if (!retried) {
      // 304 但本地缓存丢失（多标签页清理等）：去掉条件头重试一次
      return fetchConfig(true, true);
    }
    throw new BusinessApiError(-1, '客户端配置不可用');
  }

  const config = unwrapEnvelope<ClientConfigResponse>(response.data);
  writeStorage(CONFIG_KEY, {
    cacheVersion: CACHE_VERSION,
    platform: PLATFORM,
    etag: String(response.headers.etag ?? ''),
    config,
    fetchedAt: Date.now(),
  });
  return config;
}

// ———— 配置项元数据（无 ETag，按 TTL 缓存） ————

let schemaInflight: Promise<ClientConfigSchemaResponse> | undefined;

export function getClientConfigSchema(force = false): Promise<ClientConfigSchemaResponse> {
  if (!schemaInflight) {
    schemaInflight = fetchSchema(force).finally(() => {
      schemaInflight = undefined;
    });
  }
  return schemaInflight;
}

async function fetchSchema(force: boolean): Promise<ClientConfigSchemaResponse> {
  const cached = readStorage<SchemaCache>(SCHEMA_KEY);
  if (
    !force &&
    cached &&
    cached.cacheVersion === CACHE_VERSION &&
    Date.now() - cached.fetchedAt <= SCHEMA_TTL
  ) {
    return cached.schema;
  }

  let response;
  try {
    response = await http.request({ url: '/client-config/schema', method: 'GET' });
  } catch (err) {
    throw normalizeError(err);
  }

  const schema = unwrapEnvelope<ClientConfigSchemaResponse>(response.data);
  writeStorage(SCHEMA_KEY, {
    cacheVersion: CACHE_VERSION,
    schema,
    fetchedAt: Date.now(),
  });
  return schema;
}
