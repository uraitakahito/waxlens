import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Cover both `.test.ts` and `.test.tsx` — the TUI tests live in
    // tsx files because `ink-testing-library`'s `render(<App .../>)`
    // accepts a JSX element directly.
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
    clearMocks: true,
  },
});
