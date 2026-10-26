import { describe, it, expect } from 'vitest';
import {
  isBlockedMediaHost,
  isOmniInternalOnlyKind,
  mediaToContentAttributes,
  persistMediaBuffer,
  resolveOutgoingAction,
  toPublicMediaUrl,
} from '../shared/services/channel-media.js';
import { mapContentAttributesToKind } from '../shared/services/message-kind.js';
import { CHANNEL_TYPES } from '../shared/channels/types.js';
import { validMediaUrl } from '../modules/access/access.media.js';

describe('resolveOutgoingAction', () => {
  it('keeps red packet and shake inside Omni', () => {
    expect(isOmniInternalOnlyKind('red_packet')).toBe(true);
    expect(resolveOutgoingAction(CHANNEL_TYPES.WECHAT_MP, 'red_packet')).toEqual({
      action: 'skip',
      reason: 'internal_only',
    });
    expect(resolveOutgoingAction(CHANNEL_TYPES.TELEGRAM, 'shake')).toEqual({
      action: 'skip',
      reason: 'internal_only',
    });
  });

  it('skips widget because the message is already in Omni', () => {
    expect(resolveOutgoingAction(CHANNEL_TYPES.WEB_WIDGET, 'image')).toEqual({
      action: 'skip',
      reason: 'widget',
    });
    expect(resolveOutgoingAction(CHANNEL_TYPES.WEB_WIDGET, 'text')).toEqual({
      action: 'skip',
      reason: 'widget',
    });
  });

  it('sends text-like kinds through existing send*Text', () => {
    expect(resolveOutgoingAction(CHANNEL_TYPES.TELEGRAM, 'text')).toEqual({ action: 'send_text' });
    expect(resolveOutgoingAction(CHANNEL_TYPES.WECHAT_MP, 'news')).toEqual({ action: 'send_text' });
    expect(resolveOutgoingAction(CHANNEL_TYPES.EMAIL, undefined)).toEqual({ action: 'send_text' });
  });

  it('does not send [图片] as text when the channel has no media sender', () => {
    expect(resolveOutgoingAction(CHANNEL_TYPES.WEIBO, 'image')).toEqual({
      action: 'unsupported',
      error: `channel ${CHANNEL_TYPES.WEIBO} does not support outbound image yet`,
    });
  });

  it('routes P3 overseas IM to send_media', () => {
    expect(resolveOutgoingAction(CHANNEL_TYPES.TELEGRAM, 'image')).toEqual({
      action: 'send_media',
      mediaKind: 'image',
    });
    expect(resolveOutgoingAction(CHANNEL_TYPES.LINE, 'voice')).toEqual({
      action: 'send_media',
      mediaKind: 'voice',
    });
    expect(resolveOutgoingAction(CHANNEL_TYPES.WHATSAPP, 'video')).toEqual({
      action: 'send_media',
      mediaKind: 'video',
    });
    expect(resolveOutgoingAction(CHANNEL_TYPES.FACEBOOK, 'file')).toEqual({
      action: 'send_media',
      mediaKind: 'file',
    });
    expect(resolveOutgoingAction(CHANNEL_TYPES.INSTAGRAM, 'image')).toEqual({
      action: 'send_media',
      mediaKind: 'image',
    });
  });

  it('routes P1 channels to send_media', () => {
    expect(resolveOutgoingAction(CHANNEL_TYPES.WECHAT_MP, 'image')).toEqual({
      action: 'send_media',
      mediaKind: 'image',
    });
    expect(resolveOutgoingAction(CHANNEL_TYPES.WECHAT_MP, 'voice')).toEqual({
      action: 'send_media',
      mediaKind: 'voice',
    });
    expect(resolveOutgoingAction(CHANNEL_TYPES.WECOM_KF, 'file')).toEqual({
      action: 'send_media',
      mediaKind: 'file',
    });
    expect(resolveOutgoingAction(CHANNEL_TYPES.EMAIL, 'image')).toEqual({
      action: 'send_media',
      mediaKind: 'image',
    });
  });
});

describe('mapContentAttributesToKind', () => {
  it('maps voice and video', () => {
    expect(mapContentAttributesToKind({ kind: 'voice' }, 0)).toBe('voice');
    expect(mapContentAttributesToKind({ kind: 'video' }, 0)).toBe('video');
    expect(mapContentAttributesToKind({ kind: 'sms_outbound' }, 1)).toBe('sms');
    expect(mapContentAttributesToKind({}, 0)).toBe('text');
  });
});

describe('media attributes', () => {
  it('round-trips content_attributes', () => {
    const attrs = mediaToContentAttributes({
      kind: 'image',
      file_url: '/uploads/a.jpg',
      file_name: 'a.jpg',
      content_type: 'image/jpeg',
      byte_size: 12,
      caption: 'hi',
    });
    expect(attrs.kind).toBe('image');
    expect(attrs.file_url).toBe('/uploads/a.jpg');
  });
});

describe('persistMediaBuffer', () => {
  it('writes under /uploads and rejects oversized buffers', async () => {
    const saved = await persistMediaBuffer(Buffer.from('hello'), {
      fileName: 'note.txt',
      contentType: 'text/plain',
    });
    expect(saved.file_url).toMatch(/^\/uploads\//);
    expect(saved.file_name).toBe('note.txt');
    expect(saved.byte_size).toBe(5);

    await expect(
      persistMediaBuffer(Buffer.alloc(21 * 1024 * 1024), { fileName: 'big.bin' }),
    ).rejects.toThrow('20MB');
  });
});

describe('media url guards', () => {
  it('blocks loopback and RFC1918 hosts', () => {
    expect(isBlockedMediaHost('localhost')).toBe(true);
    expect(isBlockedMediaHost('127.0.0.1')).toBe(true);
    expect(isBlockedMediaHost('10.0.0.2')).toBe(true);
    expect(isBlockedMediaHost('192.168.1.1')).toBe(true);
    expect(isBlockedMediaHost('172.22.0.7')).toBe(true);
    expect(isBlockedMediaHost('mmbiz.qpic.cn')).toBe(false);
  });

  it('absolutizes relative upload paths when public base is set', () => {
    const url = toPublicMediaUrl('/uploads/a.jpg');
    expect(new URL(url, 'http://omni.local').pathname).toBe('/uploads/a.jpg');
    expect(validMediaUrl(url)).toBe(true);
  });
});
