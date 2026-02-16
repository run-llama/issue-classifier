import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/"],
    },
  },
  resolve: {
    alias: {
      "@": "./src",
    },
    conditions: ["node", "import", "module", "default"],
  },
  ssr: {
    noExternal: ["agentfs-sdk", "@tursodatabase/database"],
  },
  esbuild: {
    target: "es2022",
  },
});
