import type { BusinessEvent } from './event.js';
import { EventTypes } from './event-types.js';

export interface EventTypeRegistration {
  eventType: string;
  /** 已注册的 payload 版本（含当前） */
  versions: number[];
  currentVersion: number;
}

const registry = new Map<string, EventTypeRegistration>();

export function registerEventType(eventType: string, version = 1): void {
  const existing = registry.get(eventType);
  if (!existing) {
    registry.set(eventType, { eventType, versions: [version], currentVersion: version });
    return;
  }
  if (!existing.versions.includes(version)) existing.versions.push(version);
  if (version > existing.currentVersion) existing.currentVersion = version;
}

export function getEventRegistration(eventType: string): EventTypeRegistration | undefined {
  return registry.get(eventType);
}

/** 消费方必须忽略未知字段：返回浅拷贝，不删多余键。 */
export function acceptEvent<P>(event: BusinessEvent<P>): BusinessEvent<P> {
  return { ...event, payload: event.payload, trace: event.trace ? { ...event.trace } : undefined };
}

export function isVersionSupported(eventType: string, version: number): boolean {
  const reg = registry.get(eventType);
  if (!reg) return true;
  return reg.versions.includes(version) || version <= reg.currentVersion;
}

export function registerBuiltinEventTypes(): void {
  for (const eventType of Object.values(EventTypes)) {
    registerEventType(eventType, 1);
  }
}

registerBuiltinEventTypes();
