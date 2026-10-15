import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['{apps,packages,infra}/**/*.test.{ts,tsx}'], environment: 'node' },
});
