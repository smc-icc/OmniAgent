export const WA_CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;

export function nextWhatsappWindowUntil(now = Date.now()): number {
  return now + WA_CUSTOMER_WINDOW_MS;
}

export function isWhatsappCustomerWindowOpen(until: unknown, now = Date.now()): boolean {
  const n = Number(until);
  return Number.isFinite(n) && n > now;
}

export interface WhatsappTemplateConfig {
  name: string;
  language: string;
  includeBody: boolean;
}

export function resolveWhatsappTemplate(cfg: Record<string, unknown>, templates?: unknown): WhatsappTemplateConfig | null {
  const fromCfg = String(cfg.template_name ?? cfg.default_template ?? '').trim();
  const fromJson = templates && typeof templates === 'object'
    ? String((templates as Record<string, unknown>).default_name ?? (templates as Record<string, unknown>).name ?? '').trim()
    : '';
  const name = fromCfg || fromJson;
  if (!name) return null;
  const language = String(cfg.template_language ?? 'zh_CN').trim() || 'zh_CN';
  const includeBody = cfg.template_include_body === true || cfg.template_has_body === true;
  return { name, language, includeBody };
}
