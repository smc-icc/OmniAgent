export type FaqArticle = {
  title?: string | null;
  description?: string | null;
  content?: string | null;
};

export function wantsStaffTransfer(text: string): boolean {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return /人工|转坐席|转客服|live\s*agent|human/.test(t) || t === 'agent' || t === 'staff';
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[\s,，。！？、；;:：]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

export function matchFaqArticles(question: string, articles: FaqArticle[]): FaqArticle | null {
  const q = String(question || '').trim();
  if (!q || !articles.length) return null;
  const tokens = tokenize(q);
  let best: { art: FaqArticle; score: number } | null = null;
  for (const art of articles) {
    const hay = `${art.title || ''} ${art.description || ''} ${String(art.content || '').slice(0, 800)}`.toLowerCase();
    if (!hay.trim()) continue;
    let score = 0;
    if (art.title && q.includes(String(art.title))) score += 8;
    for (const tok of tokens) {
      if (hay.includes(tok)) score += tok.length >= 4 ? 3 : 2;
    }
    if (score > 0 && (!best || score > best.score)) best = { art, score };
  }
  return best && best.score >= 2 ? best.art : null;
}

export function formatFaqReply(art: FaqArticle, fallback = ''): string {
  const title = String(art.title || '').trim();
  const body = String(art.content || art.description || '').replace(/<[^>]+>/g, '').trim();
  if (!body && !title) return fallback;
  if (title && body) return `【${title}】\n${body.slice(0, 800)}`;
  return (body || title || fallback).slice(0, 800);
}
