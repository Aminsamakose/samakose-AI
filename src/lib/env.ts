/** Environment access. Read lazily so tests can change values. */
const str = (k: string, d = '') => process.env[k] ?? d;
export const env = {
  get nodeEnv() { return str('NODE_ENV', 'development'); },
  get isProd() { return str('NODE_ENV') === 'production'; },
  get appUrl() { return str('APP_URL', 'http://localhost:3000').replace(/\/$/, ''); },
  get sessionSecret() {
    const s = str('SESSION_SECRET');
    if (!s && this.isProd) throw new Error('SESSION_SECRET must be set in production');
    return s || 'dev-only-secret-change-me-dev-only-secret';
  },
  get cronSecret() { return str('CRON_SECRET'); },
  get trustProxy() { return str('TRUST_PROXY') === '1'; },
  get mfaRequiredRoles() { return str('MFA_REQUIRED_ROLES', '').split(',').map((s) => s.trim()).filter(Boolean); },
  get aiMode() { return str('AI_MODE', 'mock'); },
  get claudeKey() { return str('CLAUDE_API_KEY'); },
  get claudeModel() { return str('CLAUDE_MODEL', 'claude-sonnet-5-5'); },
  get koboSecret() { return str('KOBO_WEBHOOK_SECRET'); },
  get koboServer() { return str('KOBO_SERVER', 'https://kf.kobotoolbox.org'); },
  get koboToken() { return str('KOBO_TOKEN'); },
  get koboAsset() { return str('KOBO_ASSET_UID'); },
  get paystackSecret() { return str('PAYSTACK_SECRET_KEY'); },
  get smtpHost() { return str('SMTP_HOST'); },
  get smtpPort() { return Number(str('SMTP_PORT', '587')); },
  get smtpUser() { return str('SMTP_USER'); },
  get smtpPass() { return str('SMTP_PASS'); },
  get mailFrom() { return str('MAIL_FROM', 'Samakose <no-reply@samakose.com>'); },
  get storageDir() { return str('STORAGE_DIR', './storage'); },
  get storageDriver() { return str('STORAGE_DRIVER', process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'disk'); },
  get s3Bucket() { return str('S3_BUCKET'); },
  get s3Region() { return str('S3_REGION', 'auto'); },
  get s3Endpoint() { return str('S3_ENDPOINT'); },
  get s3AccessKey() { return str('S3_ACCESS_KEY_ID'); },
  get s3SecretKey() { return str('S3_SECRET_ACCESS_KEY'); },
  get s3PathStyle() { return str('S3_FORCE_PATH_STYLE', '1') !== '0'; },
  /** Vercel rejects request bodies over 4.5 MB, so the default limit is lower there. */
  get maxUploadBytes() { return Number(str('MAX_UPLOAD_MB', process.env.VERCEL ? '4' : '10')) * 1024 * 1024; }
};
