// 平台 ID → 展示名，取值与 SDK PlatformID（对齐 constant.PlatformID*）一致。

import { PlatformID } from '@goim/web-sdk';

const LABELS: Record<number, string> = {
  [PlatformID.IOS]: 'iOS',
  [PlatformID.Android]: 'Android',
  [PlatformID.Windows]: 'Windows',
  [PlatformID.OSX]: 'macOS',
  [PlatformID.Web]: 'Web',
  [PlatformID.HarmonyOS]: 'HarmonyOS',
};

export function platformLabel(platform: number): string {
  return LABELS[platform] ?? `平台 ${platform}`;
}
