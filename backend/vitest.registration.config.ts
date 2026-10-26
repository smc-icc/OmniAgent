import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['src/__tests__/registration-*.test.ts', 'src/__tests__/conf-registration-delivery.test.ts'], setupFiles: ['src/__tests__/env-setup.ts'] } });
