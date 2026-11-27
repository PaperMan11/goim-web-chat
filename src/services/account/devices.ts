// 设备管理：已登记设备列表与移除设备（会连带撤销该设备的全部会话）。

import { getDeviceId } from '@/api/client';
import { listDevices, removeDevice, type DeviceView } from '@/api/account/device';

export type { DeviceView };

export function loadDevices(): Promise<DeviceView[]> {
  return listDevices();
}

// 当前浏览器的设备标识（X-Device-Id），用于在列表里区分「本机」
export function isCurrentDevice(deviceId: string): boolean {
  return deviceId === getDeviceId();
}

// 移除设备 = 删除记录 + 撤销其全部会话；本机不允许移除，避免把自己踢下线
export async function removeDeviceByID(deviceId: string): Promise<void> {
  if (isCurrentDevice(deviceId)) throw new Error('不能移除当前设备');
  await removeDevice(deviceId);
}
