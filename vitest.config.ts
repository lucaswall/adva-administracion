import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      API_SECRET: 'test-secret-token',
      GOOGLE_SERVICE_ACCOUNT_KEY: 'test-service-account-key',
      GEMINI_API_KEY: 'test-gemini-key',
      DRIVE_ROOT_FOLDER_ID: 'test-root-folder-id',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '**/*.test.ts',
        '**/*.config.ts',
        'src/server.ts', // Server entry point
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
