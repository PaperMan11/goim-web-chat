// 统一错误文案：业务错误码、SDK 错误码与普通异常分别处理。

import { isGoimError } from '@goim/web-sdk';
import { isBusinessApiError } from '@/api/client';

export function errorMessage(err: unknown): string {
  if (isBusinessApiError(err)) return `[${err.code}] ${err.message}`;
  if (isGoimError(err)) return `[${err.code}] ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
