import { defineConfig } from 'vitest/config';
import path from 'node:path';

/** Synthetic-data validation run. Always points at an isolated database, never production. */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node', include: ['uat/**/*.test.ts'], globalSetup: ['tests/global-setup.ts'], fileParallelism: false, testTimeout: 120_000, hookTimeout: 120_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/samakose_uat', NODE_ENV: 'test', SESSION_SECRET: 'uat-secret-uat-secret-uat-secret-1234567',
      STORAGE_DIR: path.resolve(__dirname, '.uat-storage'), DISABLE_INPROCESS_JOBS: '1', AI_MODE: 'mock', APP_URL: 'http://localhost:3000', MAX_UPLOAD_MB: '1',
      KOBO_WEBHOOK_SECRET: 'kobo-test-secret', PAYSTACK_SECRET_KEY: '', MFA_REQUIRED_ROLES: '', TRUST_PROXY: '1'
    }
  }
});
