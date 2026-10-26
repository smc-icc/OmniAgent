import type { FastifyInstance } from 'fastify';
import {
  hcPortal, hcCategories, hcCategory,
  hcArticles, hcArticle, hcTrackingPixel,
} from './helpcenter.controller.js';

/**
 * Public Help Center routes — unauthenticated, customer-facing.
 * Chatwoot equivalent: app/controllers/public/api/v1/portals/
 *
 * Routes:
 *   GET /hc/:slug                     → Portal landing (redirects to default locale)
 *   GET /hc/:slug/:locale             → Portal show
 *   GET /hc/:slug/:locale/categories  → List categories
 *   GET /hc/:slug/:locale/categories/:category_slug → Show category
 *   GET /hc/:slug/:locale/articles    → List articles (with search/pagination)
 *   GET /hc/:slug/articles/:article_slug → Show article
 *   GET /hc/:slug/articles/:article_slug.png → Tracking pixel
 */
export default async function helpCenterRoutes(fastify: FastifyInstance) {
  // Portal
  fastify.get('/hc/:slug', hcPortal);
  fastify.get('/hc/:slug/:locale', hcPortal);

  // Categories
  fastify.get('/hc/:slug/:locale/categories', hcCategories);
  fastify.get('/hc/:slug/:locale/categories/:category_slug', hcCategory);

  // Articles
  fastify.get('/hc/:slug/:locale/articles', hcArticles);
  fastify.get('/hc/:slug/:locale/categories/:category_slug/articles', hcArticles);
  fastify.get('/hc/:slug/articles/:article_slug', hcArticle);

  // Tracking pixel
  fastify.get('/hc/:slug/articles/:article_slug.png', hcTrackingPixel);
}
