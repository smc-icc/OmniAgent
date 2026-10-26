import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment:'node',include:['src/__tests__/voice-tenancy.test.ts','src/__tests__/ccs-ui-away.test.ts','src/__tests__/conversation-lifecycle.test.ts'],setupFiles:['src/__tests__/env-setup.ts'],reporters:'verbose',testTimeout:10000 } });
