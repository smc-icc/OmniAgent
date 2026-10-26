import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { MultipartFile } from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fp from 'fastify-plugin';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const LOCAL_UPLOAD_DIR = env.LOCAL_UPLOAD_DIR
  ?? path.join(__dirname, '../../data/uploads');

function isS3Configured(): boolean {
  return !!(env.S3_ACCESS_KEY && env.S3_SECRET_KEY);
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name || 'file');
  return base.replace(/[^\w.\-()+ ]/g, '_') || 'file';
}

declare module 'fastify' {
  interface FastifyInstance {
    uploadToS3: (key: string, body: Buffer, contentType: string) => Promise<string>;
    getS3SignedUrl: (key: string, expiresIn?: number) => Promise<string>;
    deleteFromS3: (key: string) => Promise<void>;
    usesLocalFileStorage: boolean;
  }
}

async function s3Plugin(fastify: FastifyInstance) {
  const useLocal = !isS3Configured();
  fastify.decorate('usesLocalFileStorage', useLocal);

  await fs.mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
  await fastify.register(fastifyStatic, {
    root: LOCAL_UPLOAD_DIR,
    prefix: '/uploads/',
    decorateReply: false,
  });
  if (useLocal) {
    fastify.log.info({ dir: LOCAL_UPLOAD_DIR }, 'S3 not configured — using local file storage');
  } else {
    fastify.log.info({ dir: LOCAL_UPLOAD_DIR }, 'Serving /uploads from local dir (channel media persist)');
  }

  const s3 = useLocal
    ? null
    : new S3Client({
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT || undefined,
        forcePathStyle: !!env.S3_ENDPOINT,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY!,
          secretAccessKey: env.S3_SECRET_KEY!,
        },
      });

  const bucket = env.S3_BUCKET || 'omniagent-uploads';

  const publicObjectUrl = (key: string) => {
    const publicBase = (env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT || '').replace(/\/$/, '');
    if (publicBase) {
      return `${publicBase}/${bucket}/${key}`;
    }
    return `https://${bucket}.s3.${env.S3_REGION}.amazonaws.com/${key}`;
  };

  fastify.decorate('uploadToS3', async (key: string, body: Buffer, _contentType: string) => {
    const safeName = sanitizeFilename(path.basename(key));
    await fs.mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
    await fs.writeFile(path.join(LOCAL_UPLOAD_DIR, safeName), body);
    const localUrl = `/uploads/${safeName}`;
    if (useLocal || !s3) return localUrl;

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: _contentType,
    });
    await s3.send(command).catch(() => undefined);
    // 渠道出站读本地 /uploads，不依赖 MinIO 是否可达
    return localUrl;
  });

  fastify.decorate('getS3SignedUrl', async (key: string, expiresIn = 3600) => {
    if (useLocal) {
      return `/uploads/${sanitizeFilename(path.basename(key))}`;
    }
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(s3!, command, { expiresIn });
  });

  fastify.decorate('deleteFromS3', async (key: string) => {
    if (useLocal) {
      const filePath = path.join(LOCAL_UPLOAD_DIR, sanitizeFilename(path.basename(key)));
      await fs.unlink(filePath).catch(() => undefined);
      return;
    }
    await s3!.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  });
}

export default fp(s3Plugin, { name: 's3' });

// ── Direct Upload Route Handler ──

export async function directUploadRoute(request: FastifyRequest, reply: FastifyReply) {
  const data = await (request as unknown as { file: () => Promise<MultipartFile | undefined> }).file();
  if (!data) {
    return reply.status(400).send({ error: 'No file provided' });
  }

  const buffer = await data.toBuffer();
  const safeName = sanitizeFilename(data.filename);
  const key = `uploads/${Date.now()}_${safeName}`;

  try {
    const url = await request.server.uploadToS3(key, buffer, data.mimetype);
    return reply.status(200).send({
      file_url: url,
      blob_key: key,
      blob_id: key,
      content_type: data.mimetype,
      byte_size: buffer.length,
    });
  } catch (err) {
    request.log.error(err, 'File upload failed');
    const message = err instanceof Error ? err.message : 'Upload failed';
    return reply.status(500).send({ error: '文件上传失败', message });
  }
}
