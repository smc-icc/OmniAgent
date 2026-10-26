import { readFileSync } from 'node:fs';
import { prisma } from '../../plugins/db.js';
import { env } from '../../config/env.js';
import { getSmsProviderConfig } from './sms-provider.js';
import { createRegistrationConfigRuntime, REGISTRATION_CONFIG_KEY, type RegistrationConfigRepository } from './registration-config.js';
const repository: RegistrationConfigRepository = {
  read: () => prisma.platform_configs.findUnique({ where: { key: REGISTRATION_CONFIG_KEY }, select: { value: true, encrypted: true } }),
  transaction: run => prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1128354514)`;
    return run({ read: () => tx.platform_configs.findUnique({ where: { key: REGISTRATION_CONFIG_KEY }, select: { value: true, encrypted: true } }),
      write: async row => { await tx.platform_configs.upsert({ where: { key: REGISTRATION_CONFIG_KEY }, create: { key: REGISTRATION_CONFIG_KEY, category: 'registration', description: 'Encrypted registration SMS and SMTP settings', ...row }, update: row }); } });
  }),
};
export const registrationConfigRuntime = createRegistrationConfigRuntime({ repository,
  key: () => process.env.PUSH_CONFIG_ENCRYPTION_KEY?.trim() || (process.env.PUSH_CONFIG_ENCRYPTION_KEY_FILE ? readFileSync(process.env.PUSH_CONFIG_ENCRYPTION_KEY_FILE, 'utf8').trim() : ''),
  legacy: async () => ({ sms: getSmsProviderConfig(), email: { host: env.SMTP_HOST, port: env.SMTP_PORT, username: env.SMTP_USERNAME, password: env.SMTP_PASSWORD, fromEmail: process.env.CONF_ADMIN_FROM_EMAIL } }),
});
