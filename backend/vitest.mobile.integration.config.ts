import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/mobile-calling/**/*.integration.test.ts"],
    setupFiles: ["src/__tests__/env-setup.ts"],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
    reporters: "verbose",
  },
});
