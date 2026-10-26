import { prisma } from '../../plugins/db.js';

const PORTAL_SLUG = 'agent-kb';

const CATEGORIES: Array<{ slug: string; name: string; position: number }> = [
  { slug: 'faq', name: '常见问题', position: 1 },
  { slug: 'policy', name: '业务政策', position: 2 },
];

const ARTICLES: Array<{
  slug: string;
  category: string;
  title: string;
  description: string;
  content: string;
  position: number;
}> = [
  {
    slug: 'kb-transfer-agent',
    category: 'faq',
    title: '如何转人工坐席',
    description: '在会话中回复「人工」，或走 ITR 菜单「转人工」。',
    content:
      '在会话中回复「人工」，或选择菜单「1 转人工」。Omni 会向 ACD 发起 IMS 排队（MediaType=5），按技能组分配在线坐席。排队时可查看位次与预估等待。',
    position: 1,
  },
  {
    slug: 'kb-leave-message',
    category: 'faq',
    title: '在线留言说明',
    description: '非工作时间或排队溢出时，访客可留言；坐席可在「在线留言」页签认领。',
    content:
      '非工作时间由 ITR 工作时间节点切到留言节点。访客留下问题后，坐席在工作台「在线留言」认领，会话会分配给当前登录坐席。',
    position: 2,
  },
  {
    slug: 'kb-queue-wait',
    category: 'faq',
    title: '排队等待说明',
    description: '坐席会话位占满时进入 ACD 排队，可看到位次。',
    content:
      '当在线坐席会话位已满，新访客会进入技能组排队。工作台列表显示「排队 · 第N位」，接通后会收到「某某坐席为您服务」。',
    position: 3,
  },
  {
    slug: 'kb-csat',
    category: 'policy',
    title: '满意度评价说明',
    description: '坐席可发送满意度邀请，访客回复 1–5 分。',
    content:
      '坐席在会话中发送满意度后，访客回复数字 1–5 即可评分。评分会写入 csat_survey_responses，并出现在监控与 BI 报表的 CSAT 指标中。',
    position: 4,
  },
  {
    slug: 'kb-charger',
    category: 'policy',
    title: '充电桩故障排查',
    description: '充电桩无法启动时的常见处理步骤。',
    content:
      '请先确认充电枪已插到位、指示灯状态，以及账户余额。若屏幕报 E02/通信失败，请重启桩端后重试；仍失败可转人工并留下桩号与时间。',
    position: 5,
  },
];

let seeded = false;

export async function ensureKnowledgeBase(): Promise<void> {
  if (seeded) return;
  const account = await prisma.accounts.findUnique({ where: { id: 1 }, select: { id: true } });
  if (!account) return;

  const portal = await prisma.portals.upsert({
    where: { slug: PORTAL_SLUG },
    create: {
      account_id: 1,
      name: '坐席知识库',
      slug: PORTAL_SLUG,
      page_title: '坐席知识库',
      header_text: '全媒体知识库',
      config: { allowed_locales: ['zh'] },
    },
    update: { name: '坐席知识库', archived: false },
  });

  const catIds = new Map<string, number>();
  for (const c of CATEGORIES) {
    const row = await prisma.categories.upsert({
      where: {
        slug_locale_portal_id: { slug: c.slug, locale: 'zh', portal_id: portal.id },
      },
      create: {
        account_id: 1,
        portal_id: portal.id,
        name: c.name,
        slug: c.slug,
        locale: 'zh',
        position: c.position,
        description: c.name,
      },
      update: { name: c.name, position: c.position },
    });
    catIds.set(c.slug, row.id);
  }

  for (const a of ARTICLES) {
    await prisma.articles.upsert({
      where: { slug: a.slug },
      create: {
        account_id: 1,
        portal_id: portal.id,
        category_id: catIds.get(a.category) ?? null,
        title: a.title,
        description: a.description,
        content: a.content,
        slug: a.slug,
        status: 1,
        locale: 'zh',
        position: a.position,
        views: 0,
        author_id: 1,
      },
      update: {
        title: a.title,
        description: a.description,
        content: a.content,
        status: 1,
        category_id: catIds.get(a.category) ?? null,
        portal_id: portal.id,
      },
    });
  }
  seeded = true;
}
