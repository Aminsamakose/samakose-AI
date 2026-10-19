/**
 * Largest file the media library accepts. Vercel rejects request bodies over about 4.5 MB before the app runs,
 * and that reply is not JSON, so the limit is kept under it. Safe to import from both server and browser code.
 */
export const MEDIA_MAX_MB = 4;
export const MEDIA_MAX_BYTES = MEDIA_MAX_MB * 1024 * 1024;
