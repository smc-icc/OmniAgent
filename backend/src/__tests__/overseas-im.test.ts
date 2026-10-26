import { describe, it, expect } from 'vitest';
import { extractTelegramInbound } from '../modules/channels/telegram/parse.js';
import { lineMessageContent, lineMessageKind } from '../modules/channels/line/parse.js';
import { extractWhatsappInbound } from '../modules/channels/whatsapp/parse.js';
import {
  isWhatsappCustomerWindowOpen,
  nextWhatsappWindowUntil,
  resolveWhatsappTemplate,
  WA_CUSTOMER_WINDOW_MS,
} from '../modules/channels/whatsapp/window.js';
import { messengerAttachmentKind } from '../modules/channels/facebook/attachments.js';
import { requireHttpsMediaUrl } from '../shared/services/channel-media.js';

describe('Telegram inbound parse', () => {
  it('ignores group chats', () => {
    expect(extractTelegramInbound({
      message_id: 1,
      chat: { id: 9, type: 'group' },
      text: 'hi',
    })).toBeNull();
  });

  it('keeps private text', () => {
    expect(extractTelegramInbound({
      message_id: 1,
      chat: { id: 9, type: 'private' },
      text: 'hello',
    })).toEqual({ content: 'hello' });
  });

  it('picks the largest photo', () => {
    const parsed = extractTelegramInbound({
      message_id: 2,
      chat: { id: 9, type: 'private' },
      caption: 'look',
      photo: [
        { file_id: 'small' },
        { file_id: 'large' },
      ],
    });
    expect(parsed?.hint?.kind).toBe('image');
    expect(parsed?.hint?.fileId).toBe('large');
    expect(parsed?.content).toBe('look');
  });

  it('maps document / voice / video', () => {
    expect(extractTelegramInbound({
      message_id: 3,
      chat: { id: 9, type: 'private' },
      document: { file_id: 'd1', file_name: 'a.pdf', mime_type: 'application/pdf' },
    })?.hint).toMatchObject({ kind: 'file', fileId: 'd1', fileName: 'a.pdf' });
    expect(extractTelegramInbound({
      message_id: 4,
      chat: { id: 9, type: 'private' },
      voice: { file_id: 'v1', mime_type: 'audio/ogg' },
    })?.hint?.kind).toBe('voice');
    expect(extractTelegramInbound({
      message_id: 5,
      chat: { id: 9, type: 'private' },
      video: { file_id: 'vid', mime_type: 'video/mp4' },
    })?.hint?.kind).toBe('video');
  });
});

describe('LINE inbound parse', () => {
  it('maps message types', () => {
    expect(lineMessageKind('text')).toBe('text');
    expect(lineMessageKind('image')).toBe('image');
    expect(lineMessageKind('audio')).toBe('voice');
    expect(lineMessageKind('video')).toBe('video');
    expect(lineMessageKind('file')).toBe('file');
    expect(lineMessageKind('flex')).toBe('skip');
  });

  it('renders placeholders', () => {
    expect(lineMessageContent({ type: 'message', message: { type: 'text', id: '1', text: 'hi' } })).toBe('hi');
    expect(lineMessageContent({ type: 'message', message: { type: 'image', id: '2' } })).toBe('[图片]');
    expect(lineMessageContent({
      type: 'message',
      message: { type: 'file', id: '3', fileName: 'a.pdf' },
    })).toBe('[文件] a.pdf');
  });
});

describe('WhatsApp inbound + 24h window', () => {
  it('extracts image and document', () => {
    expect(extractWhatsappInbound({
      from: '1',
      id: 'm1',
      type: 'image',
      image: { id: 'mid', caption: 'pic', mime_type: 'image/jpeg' },
    })).toMatchObject({
      content: 'pic',
      hint: { kind: 'image', mediaId: 'mid' },
    });
    expect(extractWhatsappInbound({
      from: '1',
      id: 'm2',
      type: 'document',
      document: { id: 'did', filename: 'a.pdf' },
    })?.hint?.kind).toBe('file');
  });

  it('opens a 24h customer window and treats missing until as closed', () => {
    const now = 1_700_000_000_000;
    const until = nextWhatsappWindowUntil(now);
    expect(until - now).toBe(WA_CUSTOMER_WINDOW_MS);
    expect(isWhatsappCustomerWindowOpen(until, now + 1000)).toBe(true);
    expect(isWhatsappCustomerWindowOpen(until, now + WA_CUSTOMER_WINDOW_MS + 1)).toBe(false);
    expect(isWhatsappCustomerWindowOpen(undefined, now)).toBe(false);
  });

  it('resolves template from provider_config', () => {
    expect(resolveWhatsappTemplate({}, {})).toBeNull();
    expect(resolveWhatsappTemplate({
      template_name: 'hello_world',
      template_language: 'en_US',
      template_include_body: true,
    }, {})).toEqual({
      name: 'hello_world',
      language: 'en_US',
      includeBody: true,
    });
  });
});

describe('Messenger attachments', () => {
  it('maps Graph attachment types', () => {
    expect(messengerAttachmentKind('image')).toBe('image');
    expect(messengerAttachmentKind('audio')).toBe('voice');
    expect(messengerAttachmentKind('video')).toBe('video');
    expect(messengerAttachmentKind('file')).toBe('file');
    expect(messengerAttachmentKind('fallback')).toBeNull();
  });
});

describe('HTTPS media URL', () => {
  it('rejects relative paths when public base is not https', () => {
    const url = requireHttpsMediaUrl('/uploads/a.jpg');
    expect(url == null || url.startsWith('https://')).toBe(true);
  });
});
