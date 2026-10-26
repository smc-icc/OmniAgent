/** Append-only IDs. This catalog is also exported to the browser and the migration. */
export const accessModules = [
  ['conversation', '全媒体会话', 100, ['read', 'create', 'reply', 'update', 'transfer', 'close', 'delete', 'export', 'recording', 'ai', 'snatch', 'queue', 'conference']],
  ['customer', '客户', 120, ['read', 'create', 'update', 'delete', 'import', 'export', 'merge']],
  ['company', '企业', 140, ['read', 'create', 'update', 'delete']],
  ['opportunity', '商机', 150, ['read', 'create', 'update', 'delete']],
  ['voicemail', '留言', 160, ['read', 'update', 'delete', 'claim', 'recording']],
  ['outbound', '智能外呼', 180, ['read', 'create', 'update', 'delete', 'execute', 'export']],
  ['inspection', '智能质检', 200, ['read', 'create', 'update', 'delete', 'review', 'appeal', 'resolve', 'publish', 'export']],
  ['report', '报表与绩效', 220, ['read', 'export', 'update']],
  ['monitor', '坐席监控', 230, ['read', 'update', 'intervene', 'force']],
  ['channel', '渠道与工作时间', 240, ['read', 'create', 'update', 'delete', 'execute']],
  ['sms', '短信与模板', 260, ['read', 'create', 'update', 'delete', 'send']],
  ['email', '邮件', 270, ['read', 'send']],
  ['knowledge', '知识库', 280, ['read', 'create', 'update', 'delete', 'publish', 'grant', 'download', 'reindex', 'export']],
  ['ai', 'AI 助手', 300, ['read', 'create', 'update', 'delete', 'execute', 'autoreply', 'configure', 'audit']],
  ['automation', '自动化与宏', 320, ['read', 'create', 'update', 'delete', 'execute']],
  ['campaign', '营销活动', 340, ['read', 'create', 'update', 'delete', 'execute']],
  ['integration', '应用集成', 360, ['read', 'create', 'update', 'delete', 'execute']],
  ['settings', '平台配置', 380, ['read', 'create', 'update', 'delete']],
  ['organization', '组织与坐席配置', 400, ['read', 'create', 'update', 'delete']],
  ['schedule', '排班与小休审批', 420, ['read', 'create', 'update', 'delete', 'export', 'approve']],
  ['announcement', '公告', 440, ['read', 'create', 'update', 'delete']],
  ['efficiency', '标签与快捷回复', 460, ['read', 'create', 'update', 'delete']],
  ['audit', '审计日志', 480, ['read', 'export']],
  ['extension', '分机绑定', 500, ['bind_self', 'unbind_self', 'assign', 'approve']],
] as const;
export const operationNames: Record<string, string> = {
  bind_self: '本人直接绑定', unbind_self: '本人直接解绑', assign: '分配', read: '查看', create: '新增', reply: '回复', update: '修改', transfer: '转接', close: '结束', delete: '删除',
  export: '导出', recording: '录音访问', ai: 'AI 辅助', snatch: '抢接', queue: '排队取回', conference: '会议',
  import: '导入', merge: '合并', claim: '认领', execute: '执行', review: '复核', appeal: '申诉', resolve: '裁决',
  publish: '发布', intervene: '介入', force: '强制签入签出', send: '发送', approve: '审批', grant: '授予范围',
  download: '下载原件', reindex: '重建索引', autoreply: '启停自动回复', configure: '模型连接配置', audit: '使用审计',
};
export type DataScope = 'self' | 'group' | 'department' | 'account';
export const dataScopes: DataScope[] = ['self', 'group', 'department', 'account'];
// Shared configuration has no individual owner; it is explicitly account-scoped.
export const scopedModules = new Set(['conversation', 'customer', 'company', 'opportunity', 'voicemail', 'report', 'monitor', 'knowledge']);
export const permissionCatalog = accessModules.flatMap(([module, label, start, actions]) => actions.map((action, i) => ({
  value: start + i, code: `${module}.${action}`, name: `${label}：${operationNames[action]}`,
  module, moduleName: label, operation: action,
  scopes: scopedModules.has(module) ? dataScopes : ['account'] as DataScope[],
})));
