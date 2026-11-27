// 修改密码：前端先做复杂度校验，服务端成功后撤销除当前会话外的全部会话。

import { changePassword } from '@/api/account/account';

export interface ChangePasswordInput {
  oldPassword: string;
  newPassword: string;
}

// 与 goim-business 校验一致：8-64 字节且同时包含字母与数字
export function validateNewPassword(password: string): string | undefined {
  if (password.length < 8 || password.length > 64) return '新密码长度需为 8-64 个字符';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return '新密码需同时包含字母与数字';
  }
  return undefined;
}

export async function changeAccountPassword(input: ChangePasswordInput): Promise<void> {
  const err = validateNewPassword(input.newPassword);
  if (err) throw new Error(err);
  if (input.oldPassword === input.newPassword) throw new Error('新密码不能与原密码相同');
  await changePassword(input);
}
