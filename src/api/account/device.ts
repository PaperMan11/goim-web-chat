// 设备接口，与 goim-business internal/handler/account/device.go 一一对应。

import { request } from '../http';

// types.DeviceView（不含推送 token）
export interface DeviceView {
  deviceId: string;
  platform: number;
  appVersion: string;
  lastActiveAt: string;
}

// GET /devices：按最近活跃时间倒序
export async function listDevices(): Promise<DeviceView[]> {
  return request<DeviceView[]>('/devices', { method: 'GET' });
}

// DELETE /devices/{deviceId}：删除设备记录并撤销该设备的全部会话
export async function removeDevice(deviceId: string): Promise<void> {
  await request<unknown>(`/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
  });
}
