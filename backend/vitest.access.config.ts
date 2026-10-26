import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['src/__tests__/access-*.test.ts'], setupFiles: ['src/__tests__/env-setup.ts'], reporters: 'verbose' } });
