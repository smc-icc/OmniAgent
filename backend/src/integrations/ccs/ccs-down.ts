/**
 * CCS 断线：清本地话务会话并通知全部 Omni 坐席回登录页。
 * 不再调 DoAgentLoggedOff（对端已不可达）。
 */

export const CCS_DOWN_EVENT = 'ccs.down';
/** 全员轻量脉冲：up + generation + bootId，与座席数无关。 */
export const CCS_HEALTH_EVENT = 'ccs.health';

export function handleCcsDown(deps: {
  listUserIds: () => number[];
  clearSession: (userId: number) => void;
  clearQueue: (userId: number) => void;
  clearSignedIn: () => void;
  emitToAll: (event: string, data: unknown) => void;
}): { cleared: number } {
  const userIds = deps.listUserIds();
  for (const userId of userIds) {
    deps.clearQueue(userId);
    deps.clearSession(userId);
  }
  deps.clearSignedIn();
  deps.emitToAll(CCS_DOWN_EVENT, {
    reason: 'ccs_unreachable',
    message: '话务服务已断开，请重新登录',
  });
  return { cleared: userIds.length };
}
