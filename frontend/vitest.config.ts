import { defineConfig } from "vitest/config";

// Node environment: tests cover pure modules, API route handlers (with their
// Redis / network dependencies mocked) and components rendered to static
// markup via react-dom/server — no DOM needed.
export default defineConfig({
  // tsconfig keeps `"jsx": "preserve"` for Next; tests need JSX compiled.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
