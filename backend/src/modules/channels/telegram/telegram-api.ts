export async function registerTelegramWebhook(botToken: string, webhookUrl: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl }),
  });
  const json = (await res.json()) as { ok?: boolean; description?: string };
  if (!json.ok) {
    throw new Error(json.description ?? 'Telegram setWebhook failed');
  }
}

export async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!json.ok) return { ok: false, error: json.description ?? 'send failed' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}

export async function getTelegramFileUrl(botToken: string, fileId: string): Promise<string | null> {
  const id = String(fileId || '').trim();
  if (!id) return null;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(id)}`,
    );
    const json = (await res.json()) as { ok?: boolean; result?: { file_path?: string } };
    const filePath = json.result?.file_path;
    if (!json.ok || !filePath) return null;
    return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  } catch {
    return null;
  }
}

export async function sendTelegramFile(
  botToken: string,
  chatId: string,
  method: 'sendPhoto' | 'sendVoice' | 'sendVideo' | 'sendDocument',
  field: 'photo' | 'voice' | 'video' | 'document',
  body: Buffer,
  opts?: { fileName?: string; contentType?: string; caption?: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    const blob = new Blob([new Uint8Array(body)], { type: opts?.contentType || 'application/octet-stream' });
    form.append(field, blob, opts?.fileName || field);
    if (opts?.caption) form.append('caption', opts.caption);
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      body: form,
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!json.ok) return { ok: false, error: json.description ?? 'send failed' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send failed' };
  }
}
