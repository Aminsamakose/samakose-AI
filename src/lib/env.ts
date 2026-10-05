/** Environment access. Read lazily so tests can change values. */
const str = (k: string, d = '') => process.env[k] ?? d;
export const env = {
  get nodeEnv() { return str('NODE_ENV', 'development'); },
  /** How many proxies append to X-Forwarded-For in front of the app. Vercel is 1. */
  get trustedProxyHops() { const n = Number(str('TRUSTED_PROXY_HOPS', '1')); return Number.isInteger(n) && n >= 1 ? n : 1; },
  get isProd() { return str('NODE_ENV') === 'production'; },
  get googleClientId() { return str('GOOGLE_CLIENT_ID'); },
  get googleClientSecret() { return str('GOOGLE_CLIENT_SECRET'); },
  get appUrl() { return str('APP_URL', 'http://localhost:3000').replace(/\/$/, ''); },
  get sessionSecret() {
    const s = str('SESSION_SECRET');
    if (!s && this.isProd) throw new Error('SESSION_SECRET must be set in production');
    return s || 'dev-only-secret-change-me-dev-only-secret';
  },
  get cronSecret() { return str('CRON_SECRET'); },
  get trustProxy() { return str('TRUST_PROXY') === '1'; },
  get mfaRequiredRoles() { return str('MFA_REQUIRED_ROLES', this.isProd ? 'ADMIN,EXECUTIVE,FINANCE,REVIEWER' : '').split(',').map((s) => s.trim()).filter(Boolean); },
  get aiMode() { return str('AI_MODE', 'mock'); },
  get claudeKey() { return str('CLAUDE_API_KEY'); },
  get claudeModel() { return str('CLAUDE_MODEL', 'claude-sonnet-5-5'); },
  /** Which model provider handles live AI: 'anthropic' (Claude, default), 'openai' (ChatGPT), or 'openai-compatible' (any service that speaks the OpenAI chat format, such as Gemini, Mistral, Groq or Azure, via OPENAI_BASE_URL). */
  get aiProvider() { return str('AI_PROVIDER', 'anthropic').trim().toLowerCase(); },
  get openaiKey() { return str('OPENAI_API_KEY').trim().replace(/^["']|["']$/g, '').trim(); },
  get openaiModel() { return str('OPENAI_MODEL', 'gpt-5'); },
  get openaiBaseUrl() { return str('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, ''); },
  get koboSecret() { return str('KOBO_WEBHOOK_SECRET'); },
  get koboServer() { return str('KOBO_SERVER', 'https://kf.kobotoolbox.org'); },
  get koboToken() { return str('KOBO_TOKEN'); },
  get koboAsset() { return str('KOBO_ASSET_UID'); },
  // Trim whitespace and stray quotes: a pasted key often carries a trailing space or newline.
  get paystackSecret() { return str('PAYSTACK_SECRET_KEY').trim().replace(/^["']|["']$/g, '').trim(); },
  get smtpHost() { return str('SMTP_HOST'); },
  get smtpPort() { return Number(str('SMTP_PORT', '587')); },
  get smtpUser() { return str('SMTP_USER'); },
  get smtpPass() { return str('SMTP_PASS'); },
  get inquiryTo() { return str('INQUIRY_TO', 'info@samakose.com'); },
  get mailFrom() { return str('MAIL_FROM', 'Business Doctor <no-reply@samakose.com>'); },
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
