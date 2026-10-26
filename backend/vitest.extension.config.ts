import {defineConfig} from 'vitest/config';
export default defineConfig({test:{environment:'node',include:['src/__tests__/access-extension-binding.test.ts','src/__tests__/extension-binding*.test.ts'],setupFiles:['src/__tests__/env-setup.ts'],reporters:'verbose',testTimeout:30000,hookTimeout:90000}});
