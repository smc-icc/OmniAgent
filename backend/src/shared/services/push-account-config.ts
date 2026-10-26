import { readFileSync } from "node:fs";
import { prisma } from "../../plugins/db.js";
import {
  createPushAccountRuntime,
  type PushAccountSnapshot,
  type PushAccountRepository,
} from "./push-account-runtime.js";
import {
  sendManagedPush,
  validatePushAccountFields,
  MANAGED_PUSH_CAPABILITIES,
} from "./push-providers.js";
export const MANAGED_PUSH_CONFIG_KEY = "push_accounts_v1";
const CONFIG_KEY = MANAGED_PUSH_CONFIG_KEY;
function decode(
  row: { value: string; encrypted: boolean } | null,
): PushAccountSnapshot | null {
  if (!row) return null;
  if (!row.encrypted) throw new Error("Push configuration must be encrypted");
  return JSON.parse(row.value) as PushAccountSnapshot;
}
const repository: PushAccountRepository = {
  read: async () =>
    decode(
      await prisma.platform_configs.findUnique({
        where: { key: CONFIG_KEY },
        select: { value: true, encrypted: true },
      }),
    ),
  transaction: (run) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(1128354513)`;
      return run({
        read: async () =>
          decode(
            await tx.platform_configs.findUnique({
              where: { key: CONFIG_KEY },
              select: { value: true, encrypted: true },
            }),
          ),
        write: async (snapshot) => {
          await tx.platform_configs.upsert({
            where: { key: CONFIG_KEY },
            create: {
              key: CONFIG_KEY,
              category: "push",
              description: "Encrypted ConfServer managed push accounts",
              value: JSON.stringify(snapshot),
              encrypted: true,
            },
            update: {
              category: "push",
              value: JSON.stringify(snapshot),
              encrypted: true,
            },
          });
        },
      });
    }),
};
export const managedPushRuntime = createPushAccountRuntime({
  repository,
  key: () =>
    process.env.PUSH_CONFIG_ENCRYPTION_KEY?.trim() ||
    (process.env.PUSH_CONFIG_ENCRYPTION_KEY_FILE
      ? readFileSync(process.env.PUSH_CONFIG_ENCRYPTION_KEY_FILE, "utf8").trim()
      : ""),
  validate: (provider, fields) => {
    validatePushAccountFields(provider, fields);
    if (!MANAGED_PUSH_CAPABILITIES[provider].notification)
      throw new Error("Push transport not available");
  },
  send: sendManagedPush,
});
export const refreshManagedPushConfig = () => managedPushRuntime.refresh();
