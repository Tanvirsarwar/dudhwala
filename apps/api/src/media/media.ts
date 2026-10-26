import { Controller, Get, Inject, Injectable, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp, { type Metadata } from 'sharp';
import { AppError, notFound } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import type { Env } from '../config/env.js';
import { Public } from '../access/decorators.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;

/** Object storage port: local disk for development, S3-compatible for staging/production (OPEN_DECISIONS H3). */
export abstract class MediaStorage {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Public URL base; keys are appended. */
  abstract baseUrl(): string;
}

export class LocalMediaStorage extends MediaStorage {
  constructor(
    private readonly dir: string,
    private readonly base: string,
  ) {
    super();
  }
  async put(key: string, body: Buffer): Promise<void> {
    const path = this.safePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }
  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.safePath(key));
    } catch {
      return null;
    }
  }
  baseUrl(): string {
    return this.base;
  }
  private safePath(key: string): string {
    if (!/^[a-z0-9/_-]+\.webp$/.test(key)) throw notFound('Media');
    const root = resolve(this.dir);
    const p = resolve(join(root, key));
    if (!p.startsWith(root + '/')) throw notFound('Media');
    return p;
  }
}

export class S3MediaStorage extends MediaStorage {
  private readonly client: S3Client;
  constructor(private readonly env: Env) {
    super();
    this.client = new S3Client({
      region: env.STORAGE_REGION,
      endpoint: env.STORAGE_ENDPOINT || undefined,
      forcePathStyle: Boolean(env.STORAGE_ENDPOINT),
      credentials: { accessKeyId: env.STORAGE_ACCESS_KEY_ID, secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY },
      // SDK >= 3.729 adds CRC32 checksum headers by default; several S3-compatible providers reject or ignore them.
      // Only send checksums where the operation requires one (integrity is still covered by TLS and the signed payload hash).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.env.STORAGE_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }),
    );
  }
  baseUrl(): string {
    return this.env.MEDIA_PUBLIC_URL;
  }
}

export function createMediaStorage(env: Env): MediaStorage {
  if (env.MEDIA_STORAGE === 's3') return new S3MediaStorage(env);
  return new LocalMediaStorage(env.MEDIA_DIR, env.MEDIA_PUBLIC_URL || `${env.API_PUBLIC_URL}/v1/media`);
}

export interface ProcessedImage {
  key: string;
  width: number;
  height: number;
}

/**
 * Upload pipeline (SECURITY_REVIEW §5): size limit, decode with sharp (rejects
 * non-images regardless of the claimed type), JPEG/PNG/WebP only (no SVG),
 * re-encode to WebP ≤ 1600 px, metadata (EXIF/GPS) stripped, random key.
 */
@Injectable()
export class MediaService {
  constructor(@Inject(MediaStorage) private readonly storage: MediaStorage) {}

  async storeImage(folder: 'products' | 'banners', input: Buffer): Promise<ProcessedImage> {
    if (input.length === 0 || input.length > MAX_UPLOAD_BYTES) throw new AppError('VALIDATION_FAILED', 'Image must be between 1 byte and 5 MB');
    let meta: Metadata;
    try {
      meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    } catch {
      throw new AppError('VALIDATION_FAILED', 'File is not a valid image');
    }
    if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new AppError('VALIDATION_FAILED', 'Only JPEG, PNG or WebP images are accepted');
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // honour EXIF orientation, then metadata is dropped
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    const key = `${folder}/${newId()}.webp`;
    await this.storage.put(key, data, 'image/webp');
    return { key, width: info.width, height: info.height };
  }

  /** Public URL for a stored key. Absolute https URLs pass through (non-production demo seed only). */
  url(key: string): string {
    if (/^https:\/\//.test(key)) return key;
    return `${this.storage.baseUrl().replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
  }
}

/** Serves locally stored media in development (S3/CDN serves it in production). */
@Controller('media')
export class LocalMediaController {
  constructor(@Inject(MediaStorage) private readonly storage: MediaStorage) {}

  @Get(':folder/:file')
  @Public()
  async get(@Param('folder') folder: string, @Param('file') file: string, @Res() res: Response): Promise<void> {
    if (!(this.storage instanceof LocalMediaStorage)) throw notFound('Media');
    const body = await this.storage.get(`${folder}/${file}`);
    if (!body) throw notFound('Media');
    res.setHeader('content-type', 'image/webp');
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('cross-origin-resource-policy', 'cross-origin');
    res.send(body);
  }
}
