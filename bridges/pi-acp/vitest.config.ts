import { defineConfig } from "vitest/config";

// Local config so vitest does NOT walk up and load the repo root's
// vitest.config.ts (the bridge is a standalone package with its own deps).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
