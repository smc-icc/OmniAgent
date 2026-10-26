import type { HubRouteConfig } from '../config/schema.js';
import type { BusinessEvent } from '../contract/event.js';
import { matchEventType } from '../contract/event-types.js';
import { evalWhen, WhenExprError } from './when-expr.js';

export interface RouteHit {
  route: HubRouteConfig;
}

export function routeEvent(event: BusinessEvent, routes: HubRouteConfig[]): RouteHit[] {
  const hits: RouteHit[] = [];
  for (const route of routes) {
    if (!matches(event, route)) continue;
    hits.push({ route });
  }
  return hits;
}

function matches(event: BusinessEvent, route: HubRouteConfig): boolean {
  const { eventType, vdnId, when } = route.match;
  if (eventType?.length) {
    if (!eventType.some((p) => matchEventType(p, event.eventType))) return false;
  }
  if (vdnId?.length && !vdnId.includes(event.tenant.vdnId)) return false;
  if (when) {
    try {
      const ctx = {
        payload: event.payload,
        tenant: event.tenant,
        subject: event.subject,
        eventType: event.eventType,
        vdnId: event.tenant.vdnId,
      };
      if (!evalWhen(when, ctx)) return false;
    } catch (err) {
      if (err instanceof WhenExprError) throw err;
      throw new WhenExprError(err instanceof Error ? err.message : String(err));
    }
  }
  return true;
}
