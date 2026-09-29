/**
 * File storage for uploaded evidence. Two drivers behind one interface:
 *  - disk: a local directory (STORAGE_DIR). Use a persistent volume on a VPS or container host.
 *  - s3:   any S3-compatible bucket (AWS S3, Cloudflare R2, Supabase Storage). Required on Vercel, whose disk is temporary.
 * Files always pass through the API, so access checks and integrity hashes are unchanged.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { env } from './env';

export interface FileStorage {
  location: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  health(): Promise<string>;
}

class DiskStorage implements FileStorage {
  get location() { return env.storageDir; }
  async put(key: string, data: Buffer) {
    const full = path.join(env.storageDir, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { mode: 0o600 });
  }
  async get(key: string) { try { return await fs.readFile(path.join(env.storageDir, key)); } catch { return null; } }
  async health() {
    try { await fs.mkdir(env.storageDir, { recursive: true }); await fs.access(env.storageDir); return 'ok'; } catch { return 'not writable'; }
  }
}

class S3Storage implements FileStorage {
  private client?: S3Client;
  get location() { return `s3://${env.s3Bucket}`; }
  private c() {
    if (!env.s3Bucket || !env.s3AccessKey || !env.s3SecretKey) throw new Error('S3 storage needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
    return (this.client ??= new S3Client({
      region: env.s3Region, endpoint: env.s3Endpoint || undefined, forcePathStyle: env.s3PathStyle,
      credentials: { accessKeyId: env.s3AccessKey, secretAccessKey: env.s3SecretKey }
    }));
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.c().send(new PutObjectCommand({ Bucket: env.s3Bucket, Key: key, Body: data, ContentType: contentType }));
  }
  async get(key: string) {
    try {
      const r = await this.c().send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    } catch (e: any) {
      if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
  async health() {
    try { await this.c().send(new HeadBucketCommand({ Bucket: env.s3Bucket })); return 'ok'; } catch (e: any) { return `unreachable: ${e?.name ?? 'error'}`; }
  }
}

const disk = new DiskStorage();
const s3 = new S3Storage();
export const storage = (): FileStorage => (env.storageDriver === 's3' ? s3 : disk);
