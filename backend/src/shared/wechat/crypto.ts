import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function decodeAesKey(encodingAesKey: string): Buffer {
  const padded = encodingAesKey.endsWith('=') ? encodingAesKey : `${encodingAesKey}=`;
  return Buffer.from(padded, 'base64');
}

/** WeChat / WeCom AES message decrypt (compatible mode) */
export function decryptWeChatMessage(
  encodingAesKey: string,
  appIdOrCorpId: string,
  encrypted: string,
): string {
  const aesKey = decodeAesKey(encodingAesKey);
  const iv = aesKey.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', aesKey, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]);

  const padLen = decrypted[decrypted.length - 1]!;
  const unpadded = decrypted.subarray(0, decrypted.length - padLen);
  const contentLen = unpadded.readUInt32BE(16);
  const content = unpadded.subarray(20, 20 + contentLen).toString('utf8');
  const fromAppId = unpadded.subarray(20 + contentLen).toString('utf8');
  if (fromAppId !== appIdOrCorpId) {
    throw new Error('AppId/CorpId mismatch in decrypted message');
  }
  return content;
}

/** Encrypt plaintext reply for WeChat secure mode */
export function encryptWeChatMessage(
  encodingAesKey: string,
  appIdOrCorpId: string,
  plaintext: string,
): string {
  const aesKey = decodeAesKey(encodingAesKey);
  const iv = aesKey.subarray(0, 16);
  const random = randomBytes(16);
  const msgBuf = Buffer.from(plaintext, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length, 0);
  const appIdBuf = Buffer.from(appIdOrCorpId, 'utf8');
  const raw = Buffer.concat([random, lenBuf, msgBuf, appIdBuf]);

  const blockSize = 32;
  const padLen = blockSize - (raw.length % blockSize);
  const padded = Buffer.concat([raw, Buffer.alloc(padLen, padLen)]);

  const cipher = createCipheriv('aes-256-cbc', aesKey, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString('base64');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}
