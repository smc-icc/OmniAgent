/** All operator routes must have a policy. Unclassified routes fail closed. */
export interface RoutePolicy { permission?: string; mode: 'operator' | 'session' | 'external'; resource?: string }
const external = { mode: 'external' } as const;
const session = { mode: 'session' } as const;
const op = (permission: string, resource?: string): RoutePolicy => ({ mode: 'operator', permission, resource });
export function routePolicy(method: string, url: string): RoutePolicy | undefined {
  const p = url.split('?')[0];
  const read = method === 'GET' || method === 'HEAD';
  const action = /export|download|transcript/.test(p) ? 'export' : /\/import$/.test(p) ? 'import'
    : /\/clone$/.test(p) ? 'create' : read || /\/(filter|search)$/.test(p) ? 'read'
    : method === 'DELETE' ? 'delete' : ['PUT', 'PATCH'].includes(method) ? 'update' : 'create';
  const crud = (module: string, resource?: string) => op(`${module}.${action}`, resource);
  if (p === '/health' || p === '/' || p === '/api' || /^\/(demo|hc|public|webhooks)(\/|$)/.test(p) || p.startsWith('/cable') || p.startsWith('/enterprise/webhooks/')) return external;
  if (p === '/auth') return op('organization.create'); // Provision accounts through an authorized operator.
  if (p.startsWith('/auth/')) return external; // Authentication endpoints retain their own checks.
  if (p === '/api/v1/auth/saml_login') return external;
  if (p.startsWith('/uploads/')) return external; // Guard requires a short-lived file capability.
  if (p.startsWith('/internal/hub/')) return external; // Hub validates its own service credential.
  if (/^\/api\/itr\/(callback\/|acd\/)/.test(p) || p === '/api/internal/aiqc/task-updated') return external;
  if (/^\/api\/platform-config\/.+\/sync$/.test(p) || p === '/api/platform-config/itr/inbox-binding' || (method === 'PUT' && /^\/api\/platform-config\/(public-base-url|sms-provider)$/.test(p))) return external;
  if (p === '/api/product-modules') return session;
  if (p.startsWith('/api/v1/profile') || p === '/api/v1/notification_subscriptions' || p === '/api/access/me' || p === '/api/navigation/tree') return session;
  if (p === '/api/access/tenants' && read) return external; // Own handler authenticates and filters live source bindings.
  if (p.startsWith('/api/knowledge/')) {
    if (p.endsWith('/download')) return op('knowledge.download');
    if (p.endsWith('/ask')) return op('ai.execute');
    if (p.endsWith('/publish') || p.endsWith('/withdraw')) return op('knowledge.publish');
    if (p.endsWith('/access')) return op('knowledge.grant');
    if (p.endsWith('/reindex')) return op('knowledge.reindex');
    return crud('knowledge');
  }
  if(p==='/api/access/extension-management')return session;
  if (/^\/api\/access\/extension-requests/.test(p)) return op('extension.approve');
  if (/^\/api\/access\/users\/[^/]+\/extension-binding$/.test(p)) return op('extension.assign');
  if (p.startsWith('/api/access/')) return op('access.manage');
  if (p.startsWith('/api/announcements/')) return crud('announcement');
  if (p === '/api/search/global') return op('conversation.read');
  if (p.startsWith('/platform/api/') || p.startsWith('/enterprise/api/')) return op('access.manage');
  // These endpoints authenticate the ConfServer service credential in their own handlers.
  if (p === '/api/platform-config/push-accounts' || p === '/api/platform-config/push-accounts/test') return external;
  if ((['GET','HEAD'].includes(method) && ['/api/platform-config/conf-registration/readiness', '/api/platform-config/conf-registration/config'].includes(p)) || (method === 'PUT' && p === '/api/platform-config/conf-registration/config') || (method === 'POST' && ['/api/platform-config/conf-registration/deliver', '/api/platform-config/conf-registration/test'].includes(p))) return external; // Each exact route requires the ConfServer sync credential.
  if (p === '/api/v1/vdn/working_hours') return crud('settings');
  if (p.startsWith('/api/platform-config/')) return crud('settings');
  if (p.startsWith('/api/agent/internal-chats') && p.endsWith('/approve-rest')) return op('schedule.approve');
  if (p.startsWith('/api/agent-shifts')) return crud('schedule');
  if (p.startsWith('/api/agent/workspace/')) return op(p.includes('queue') ? 'conversation.queue' : p.includes('snatch') ? 'conversation.snatch' : 'organization.read');
  if (p.startsWith('/api/agent/transfer/')) return op('conversation.transfer');
  if (p.startsWith('/api/agent/')) return session; // Personal agent session; CCS validates telephony powers.
  if (p.startsWith('/api/dashboard/announcements')) return read || /\/(unread|read)$/.test(p) ? session : crud('announcement');
  if (p.startsWith('/api/dashboard/')) return session;
  if (p.startsWith('/api/bi/') || p.startsWith('/api/performance/') || p === '/api/omnichannel/csat/summary' || p.startsWith('/api/omnichannel/reports/')) return op(`report.${action === 'create' ? 'update' : action}`);
  if (p.startsWith('/api/v1/qc/')) {
    const special = p.endsWith('/review') ? 'review' : p.endsWith('/appeal') ? 'appeal' : p.endsWith('/resolve') ? 'resolve' : p.endsWith('/publish') ? 'publish' : undefined;
    return op(`inspection.${special ?? (p.includes('audit-logs') ? 'read' : action)}`);
  }
  if (p.startsWith('/api/v1/outbound/')) return op(`outbound.${/\/(start|pause)$/.test(p) ? 'execute' : action}`);
  if (p.startsWith('/api/v1/monitor/')) return crud('monitor');
  if (p.startsWith('/api/v1/voicemails')) return op(`voicemail.${p.endsWith('/audio') ? 'recording' : action}`, 'voicemail');
  if (/^\/api\/itr\/(offline-messages|leave-messages)/.test(p)) return op(`voicemail.${p.endsWith('/claim') ? 'claim' : 'read'}`);
  if (p.startsWith('/api/itr/')) return p.includes('/dev/') || p.includes('/observe/') ? op('settings.read') : op('conversation.update', 'conversation');
  if (p.startsWith('/api/sms')) return op(`sms.${p.endsWith('/send') ? 'send' : action}`);
  if (p.startsWith('/api/email/')) return op(`email.${read ? 'read' : 'send'}`);
  if (/^\/api\/(customers|companies|opportunities)(\/|$)/.test(p)) return crud(p.startsWith('/api/customers') ? 'customer' : p.startsWith('/api/companies') ? 'company' : 'opportunity');
  if (p === '/api/crm/labels') return op('efficiency.read');
  if (p.startsWith('/api/omnichannel/workspace/')) {
    const tail = p.split('/').pop()!;
    const map: Record<string, string> = { 'snatch-targets': 'conversation.snatch', snatch: 'conversation.snatch', 'queue-sessions': 'conversation.queue', 'queue-take': 'conversation.queue', conference: 'conversation.conference', monitor: 'monitor.intervene', 'ims-force': 'monitor.force', 'online-agents': 'organization.read' };
    return map[tail] ? op(map[tail], 'workspace') : undefined;
  }
  if (p.startsWith('/api/omnichannel/sessions/')) {
    const tail = p.split('/').pop()!;
    const map: Record<string, string> = { messages: 'read', 'call-record': 'recording', recording: 'recording', end: 'close', shake: 'reply', ai: 'ai', 'leave-queue': 'close', transfer: 'transfer', invite: 'conference' };
    return map[tail] ? op(`conversation.${map[tail]}`, 'conversation') : undefined;
  }
  if (p.startsWith('/api/omnichannel/tts/')) return op('conversation.reply');
  if (p === '/api/omnichannel/org-matrix' || p === '/api/omnichannel/agent-stats') return op('organization.read');
  if (/^\/api\/omnichannel\/(contacts|call-records|recordings)/.test(p)) return op(`conversation.${p.includes('record') ? 'recording' : action}`);
  if (p.startsWith('/api/omnichannel/customers/') || /\/omnichannel\/(after-sales|ecom-orders)$/.test(p)) return op('customer.read');
  if (p === '/api/omnichannel/knowledge') return op('knowledge.read');
  if (p.startsWith('/api/v1/contacts/directory')) return op('organization.read');
  if (p === '/api/v1/upload') return op('conversation.reply');
  const match = /^\/api\/v[12]\/accounts\/(?:[^/]+)(?:\/(.*))?$/.exec(p);
  if (p === '/api/v1/accounts') return op('access.manage');
  if (!match) return undefined;
  const sub = match[1] ?? '';
  if (!sub || /^(update_active_at|cache_keys)$/.test(sub)) return read || sub ? session : op('settings.update');
  const root = sub.split('/')[0];
  if (root === 'conversations') {
    if (/\/draft_messages$/.test(sub)) return op('conversation.reply', 'conversation');
    if (/\/messages(?:\/|$)/.test(sub) && !read) return op(`conversation.${method === 'DELETE' ? 'delete' : 'reply'}`, 'conversation');
    if (/\/assignments$/.test(sub)) return op('conversation.transfer', 'conversation');
    if (/\/participants$/.test(sub) && !read) return op('conversation.conference', 'conversation');
    if (/\/toggle_status$/.test(sub)) return op('conversation.close', 'conversation');
    if (/\/inbox_assistant$/.test(sub)) return op('conversation.ai', 'conversation');
    if (/\/(direct_uploads|toggle_typing_status)$/.test(sub)) return op('conversation.reply', 'conversation');
    return op(`conversation.${action === 'create' && sub.includes('/') && !sub.endsWith('/filter') ? 'update' : action}`, 'conversation');
  }
  if (/^(agents|teams|custom_roles|account_users|agent_capacity_policies)$/.test(root)) return read ? op('organization.read') : op('access.manage');
  if (root === 'contacts' || root === 'companies') return crud(root === 'contacts' ? 'customer' : 'company');
  if (root === 'actions') return op('customer.merge');
  if (root === 'bulk_actions') return op('access.manage'); // Mixed-resource batch actions are administrative.
  if (root === 'contact_inboxes') return op(`customer.${read || sub.endsWith('/filter') ? 'read' : 'update'}`);
  if (root === 'inboxes' || /^(inbox_members|channel_|channels|working_hours|assignable_agents)/.test(root)) return crud('channel');
  if (root === 'captain') return /\/(tasks|copilot_threads)|playground/.test(sub) ? op('ai.execute') : crud(sub.includes('/documents') ? 'knowledge' : 'ai');
  if (root === 'agent_bots') return crud('ai');
  if (root === 'portals') return crud('knowledge');
  if (/^(notifications|notification_settings|custom_filters)$/.test(root)) return session;
  if (root === 'search') return op('conversation.read');
  if (['reports', 'summary_reports', 'live_reports', 'year_in_review', 'csat_survey_responses', 'applied_slas'].includes(root)) return crud('report');
  if (root === 'audit_logs') return crud('audit');
  if (/^(integrations|webhooks|dashboard_apps)$/.test(root)) return crud('integration');
  if (/^(automation_rules|macros|assignment_policies|sla_policies)$/.test(root)) return sub.endsWith('/execute') ? op('automation.execute') : crud('automation');
  if (root === 'campaigns') return crud('campaign');
  if (/^(labels|canned_responses|custom_attribute_definitions)$/.test(root)) return crud('efficiency');
  if (root === 'upload' || root === 'translate-text') return op('conversation.reply');
  return undefined;
}
