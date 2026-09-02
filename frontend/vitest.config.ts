import { defineConfig } from "vitest/config";

// Scoped deliberately narrow: the only unit-tested module today is the pure
// tile-identity tracker, which has no React / DOM / Next dependencies.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
