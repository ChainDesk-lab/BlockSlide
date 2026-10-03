import { defineConfig } from "@playwright/test";

/**
 * The e2e specs drive a running dev server rather than mounting components, so
 * they are kept out of `test/` (Hardhat) and `frontend` (vitest) and live in
 * `e2e/`. Previously they sat loose in the repo root with no config at all.
 */
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000" },
});
