import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';

// ── Helpers ──

function formatArticle(a: Record<string, unknown>) {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    content: a.content,
    slug: a.slug,
    status: (a.status as number) === 1 ? 'published' : 'draft',
    views: a.views,
    position: a.position,
    locale: a.locale,
    category_id: a.category_id,
    author_id: a.author_id,
    created_at: (a.created_at as Date)?.getTime(),
    updated_at: (a.updated_at as Date)?.getTime(),
    meta: a.meta,
  };
}

function formatCategory(c: Record<string, unknown>) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    locale: c.locale,
    position: c.position,
    icon: c.icon,
    articles_count: ((c as any)._count as any)?.articles ?? 0,
  };
}

function formatPortal(p: Record<string, unknown>) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    color: p.color,
    custom_domain: p.custom_domain,
    header_text: p.header_text,
    homepage_link: p.homepage_link,
    page_title: p.page_title,
    config: p.config,
    categories: (p as Record<string, unknown>).categories ?? [],
    locale: (p as Record<string, unknown>).locale,
  };
}

// ── Portal ──

/** GET /hc/:slug, GET /hc/:slug/:locale */
export async function hcPortal(request: FastifyRequest, reply: FastifyReply) {
  const { slug, locale } = request.params as { slug: string; locale?: string };

  const portal = await prisma.portals.findFirst({
    where: { slug, archived: false },
  });

  if (!portal) {
    return reply.status(404).send({ error: 'Portal not found' });
  }

  const config = (portal.config as Record<string, unknown>) ?? {};
  const allowedLocales = (config.allowed_locales as string[]) ?? ['en'];
  const targetLocale = locale && allowedLocales.includes(locale) ? locale : allowedLocales[0];

  // If no locale specified, redirect to default
  if (!locale) {
    return reply.redirect(`/hc/${slug}/${targetLocale}`);
  }

  const categories = await prisma.categories.findMany({
    where: {
      portal_id: portal.id as number,
      locale: targetLocale,
    },
    orderBy: { position: 'asc' },
    include: { _count: { select: { articles: true } } } as any,
  });

  return reply.status(200).send({
    ...formatPortal(portal as unknown as Record<string, unknown>),
    locale: targetLocale,
    categories: categories.map((c) => formatCategory(c as unknown as Record<string, unknown>)),
  });
}

// ── Categories ──

/** GET /hc/:slug/:locale/categories */
export async function hcCategories(request: FastifyRequest, reply: FastifyReply) {
  const { slug, locale } = request.params as { slug: string; locale: string };

  const portal = await prisma.portals.findFirst({
    where: { slug, archived: false },
    select: { id: true },
  });

  if (!portal) {
    return reply.status(404).send({ error: 'Portal not found' });
  }

  const categories = await prisma.categories.findMany({
    where: { portal_id: portal.id as number, locale },
    orderBy: { position: 'asc' },
    include: { _count: { select: { articles: true } } } as any,
  });

  return reply.status(200).send({
    payload: categories.map((c) => formatCategory(c as unknown as Record<string, unknown>)),
  });
}

/** GET /hc/:slug/:locale/categories/:category_slug */
export async function hcCategory(request: FastifyRequest, reply: FastifyReply) {
  const { slug, locale, category_slug } = request.params as { slug: string; locale: string; category_slug: string };

  const portal = await prisma.portals.findFirst({
    where: { slug, archived: false },
    select: { id: true },
  });

  if (!portal) {
    return reply.status(404).send({ error: 'Portal not found' });
  }

  const category = await prisma.categories.findFirst({
    where: {
      portal_id: portal.id as number,
      locale,
      slug: category_slug,
    },
    include: { _count: { select: { articles: true } } } as any,
  });

  if (!category) {
    return reply.status(404).send({ error: 'Category not found' });
  }

  const articles = await prisma.articles.findMany({
    where: {
      portal_id: portal.id as number,
      category_id: category.id as number,
      status: 1, // published
    },
    orderBy: { position: 'asc' },
  });

  return reply.status(200).send({
    ...formatCategory(category as unknown as Record<string, unknown>),
    articles: articles.map((a) => formatArticle(a as unknown as Record<string, unknown>)),
  });
}

// ── Articles ──

/** GET /hc/:slug/:locale/articles, GET /hc/:slug/:locale/categories/:category_slug/articles */
export async function hcArticles(request: FastifyRequest, reply: FastifyReply) {
  const { slug, locale, category_slug } = request.params as { slug: string; locale: string; category_slug?: string };
  const query = request.query as { search?: string; page?: string; sort?: string };

  const portal = await prisma.portals.findFirst({
    where: { slug, archived: false },
    select: { id: true },
  });

  if (!portal) {
    return reply.status(404).send({ error: 'Portal not found' });
  }

  const page = parseInt(query.page ?? '1', 10);
  const perPage = 25;
  const portalId = portal.id as number;

  const where: Record<string, unknown> = {
    portal_id: portalId,
    locale,
    status: 1, // published
  };

  if (category_slug) {
    const category = await prisma.categories.findFirst({
      where: { portal_id: portalId, slug: category_slug },
      select: { id: true },
    });
    if (category) {
      where.category_id = category.id as number;
    }
  }

  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
      { content: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const orderBy: Record<string, string> = {};
  switch (query.sort) {
    case 'views': orderBy.views = 'desc'; break;
    case 'oldest': orderBy.created_at = 'asc'; break;
    default: orderBy.position = 'asc';
  }

  const [total, articles] = await Promise.all([
    prisma.articles.count({ where: where as object }),
    prisma.articles.findMany({
      where: where as object,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return reply.status(200).send({
    payload: articles.map((a) => formatArticle(a as unknown as Record<string, unknown>)),
    meta: { current_page: page, total_count: total, per_page: perPage },
  });
}

/** GET /hc/:slug/articles/:article_slug */
export async function hcArticle(request: FastifyRequest, reply: FastifyReply) {
  const { slug, article_slug } = request.params as { slug: string; article_slug: string };

  const portal = await prisma.portals.findFirst({
    where: { slug, archived: false },
    select: { id: true },
  });

  if (!portal) {
    return reply.status(404).send({ error: 'Portal not found' });
  }

  const article = await prisma.articles.findFirst({
    where: {
      portal_id: portal.id as number,
      slug: article_slug,
      status: 1, // published
    },
  });

  if (!article) {
    return reply.status(404).send({ error: 'Article not found' });
  }

  // Increment view count (fire-and-forget)
  prisma.articles.update({
    where: { id: article.id as number },
    data: { views: ((article.views as number) ?? 0) + 1 },
  }).catch(() => {});

  return reply.status(200).send(formatArticle(article as unknown as Record<string, unknown>));
}

/** GET /hc/:slug/articles/:article_slug.png — tracking pixel */
export async function hcTrackingPixel(request: FastifyRequest, reply: FastifyReply) {
  const { slug, article_slug } = request.params as { slug: string; article_slug: string };

  const portal = await prisma.portals.findFirst({
    where: { slug, archived: false },
    select: { id: true },
  });

  if (portal) {
    // Increment view count
    prisma.articles.updateMany({
      where: { portal_id: portal.id as number, slug: article_slug },
      data: { views: { increment: 1 } },
    }).catch(() => {});
  }

  // Return a 1x1 transparent PNG
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  return reply.type('image/png').send(pixel);
}
