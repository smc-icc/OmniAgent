import { AppError } from '../../shared/errors/index.js';

/** Domestic numbers use +86; international numbers must carry an explicit country code. */
export function normalizeLoginPhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, '');
  const international = compact.startsWith('00') ? '+' + compact.slice(2) : compact;
  if (/^1\d{10}$/.test(international)) return '+86' + international;
  if (/^\+[1-9]\d{6,14}$/.test(international)) return international;
  throw new AppError(422, '请输入完整手机号，国际号码请带国家区号', 'phone_format_invalid');
}
export function phoneVdn(value: string): number {
  if (!/^[1-9]\d*$/.test(value.trim())) throw new AppError(422, '请输入管理员提供的企业代码（VDN）');
  const id = Number(value.trim());
  if (!Number.isSafeInteger(id) || id > 2147483647) throw new AppError(422, '企业代码格式无效');
  return id;
}
