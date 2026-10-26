/**
 * Seed data for OmniAgent demo — creates test inboxes, web widgets, and agent accounts.
 *
 * Usage: npx tsx src/seed.ts
 */
import { prisma } from './plugins/db.js';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

async function sql(query: string, params?: unknown[]): Promise<any> {
  return prisma.$queryRawUnsafe(query, ...(params ?? []));
}

async function main() {
  console.log('Seeding OmniAgent demo data...\n');
  const now = new Date();
  const hmacTokens: string[] = [];

  // ── 1. Account ──
  await sql(`INSERT INTO accounts (id, name, status, created_at, updated_at) VALUES (1, 'Demo Company', 0, $1, $1) ON CONFLICT (id) DO NOTHING`, [now]);
  console.log('[OK] Account: Demo Company');

  // ── 2. Agent user (uid = CCS workNO when CCS_WORK_NO_FIELD=uid) ──
  const demoWorkNo = '1001';
  const passwordHash = await bcrypt.hash('demo123456', 10);
  const pubsubToken = randomBytes(16).toString('hex');
  await sql(
    `INSERT INTO users (id, name, email, uid, encrypted_password, provider, pubsub_token, confirmed_at, created_at, updated_at)
     VALUES (1, 'Agent Wang', 'agent@demo.local', $1, $2, 'email', $3, $4, $4, $4)
     ON CONFLICT (id) DO UPDATE SET uid = EXCLUDED.uid, updated_at = EXCLUDED.updated_at`,
    [demoWorkNo, passwordHash, pubsubToken, now],
  );
  console.log(`[OK] Agent: Agent Wang (agent@demo.local / demo123456, CCS workNO=${demoWorkNo})`);

  // ── 3. Account user link ──
  await sql(`INSERT INTO account_users (id, account_id, user_id, role, created_at, updated_at) VALUES (1, 1, 1, 0, $1, $1) ON CONFLICT (id) DO NOTHING`, [now]);
  console.log('[OK] Account user linked');

  // ── 4. Inboxes + web widgets + members ──
  const depts = [
    { name: 'Tech Support', token: 'tech-support-token' },
    { name: 'Sales', token: 'sales-token' },
    { name: 'Billing', token: 'billing-token' },
    { name: 'General', token: 'general-token' },
  ];

  for (let i = 0; i < depts.length; i++) {
    const d = depts[i];
    const inboxId = i + 1;
    const hmac = randomBytes(16).toString('hex');
    hmacTokens.push(hmac);

    await sql(`INSERT INTO inboxes (id, channel_id, account_id, name, channel_type, enable_auto_assignment, greeting_enabled, greeting_message, working_hours_enabled, created_at, updated_at) VALUES ($1, $1, 1, $2, 'Channel::WebWidget', true, true, 'Welcome to ${d.name}! How can we help?', false, $3, $3) ON CONFLICT (id) DO NOTHING`, [inboxId, d.name, now]);

    await sql(`INSERT INTO channel_web_widgets (account_id, website_url, website_token, hmac_token, widget_color, welcome_title, welcome_tagline, pre_chat_form_enabled, continuity_via_email, created_at, updated_at) VALUES (1, 'http://localhost:5173', $1, $2, '#1f93ff', 'OmniAgent - ${d.name}', 'We reply within 2 mins', true, true, $3, $3) ON CONFLICT (website_token) DO NOTHING`, [d.token, hmac, now]);

    await sql(`INSERT INTO inbox_members (inbox_id, user_id, created_at, updated_at) VALUES ($1, 1, $2, $2) ON CONFLICT DO NOTHING`, [inboxId, now]);

    console.log(`[OK] Inbox: ${d.name} | token="${d.token}"`);
  }

  console.log('\nSeed complete!');
  console.log('\nWidget tokens (use in chat-widget.js data-* attributes):');
  for (const d of depts) {
    console.log(`  data-token-${d.name.toLowerCase().replace(' ', '-')}="${d.token}"`);
  }
  console.log('\nAgent: agent@demo.local / demo123456');
}

main().catch(console.error).finally(() => prisma.$disconnect());
