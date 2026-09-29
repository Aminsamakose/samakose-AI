import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node', include: ['tests/**/*.test.ts'], globalSetup: ['tests/global-setup.ts'], fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/samakose_test', NODE_ENV: 'test', SESSION_SECRET: 'test-secret-test-secret-test-secret-1234',
      STORAGE_DIR: path.resolve(__dirname, '.test-storage'), DISABLE_INPROCESS_JOBS: '1', AI_MODE: 'mock', APP_URL: 'http://localhost:3000', MAX_UPLOAD_MB: '1',
      KOBO_WEBHOOK_SECRET: 'kobo-test-secret', PAYSTACK_SECRET_KEY: '', MFA_REQUIRED_ROLES: '', TRUST_PROXY: '1'
    }
  }
});
