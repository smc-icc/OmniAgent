import { accessScope } from '../../modules/access/access.scope.js';
import { confTenancyEnabled } from './conf-tenancy.js';
import { AppError } from '../errors/index.js';
/**
 * CRM 产品层：客户档案 / 备注 / 标签 / 时间线 / 公司 / 商机
 */
import type { PrismaClient } from '@prisma/client';
import { listRecentCallsByPhone } from './icc-metrics-dal.js';

export type TimelineItem = {
  id: string;
  type: 'conversation' | 'call' | 'note';
  at: string;
  title: string;
  summary?: string;
  meta?: Record<string, unknown>;
};

export async function resolveAccountIdForUser(prisma: PrismaClient, userId: number): Promise<number> {
  const scope = accessScope.getStore();
  if (scope) return scope.accountId;
  if (confTenancyEnabled()) throw new AppError(403, '租户上下文缺失');
  const au = await prisma.account_users.findFirst({
    where: { user_id: userId },
    orderBy: { id: 'asc' },
  });
  return au?.account_id ?? 1;
}

function attrsOf(c: { custom_attributes?: unknown }) {
  return (c.custom_attributes as Record<string, unknown> | null) ?? {};
}

function pickAttr(attrs: Record<string, unknown>, key: string, fallback: string) {
  const v = attrs[key];
  return v != null && String(v).trim() ? String(v) : fallback;
}

async function loadContactLabels(prisma: PrismaClient, contactId: number) {
  const rows = await prisma.contact_labels.findMany({
    where: { contact_id: contactId },
    include: { label: { select: { id: true, title: true, color: true } } },
  });
  return rows
    .filter((r) => r.label)
    .map((r) => ({
      id: r.label.id,
      title: r.label.title ?? '',
      color: r.label.color,
    }));
}

export async function listCustomers(
  prisma: PrismaClient,
  opts: { accountId: number; q?: string; page?: number; pageSize?: number },
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const q = opts.q?.trim() ?? '';
  const where = {
    account_id: opts.accountId,
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { phone_number: { contains: q } },
            { email: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.contacts.count({ where }),
    prisma.contacts.findMany({
      where,
      orderBy: [{ last_activity_at: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        phone_number: true,
        email: true,
        location: true,
        last_activity_at: true,
        custom_attributes: true,
        contact_labels: {
          include: { label: { select: { id: true, title: true, color: true } } },
          take: 5,
        },
      },
    }),
  ]);

  const contactIds = rows.map((c) => c.id);
  const noteAggs =
    contactIds.length === 0
      ? []
      : await prisma.notes.groupBy({
          by: ['contact_id'],
          where: { contact_id: { in: contactIds }, account_id: opts.accountId },
          _max: { created_at: true },
        });
  const lastNoteMap = new Map(
    noteAggs.map((n) => [n.contact_id, n._max.created_at?.toISOString() ?? null]),
  );

  return {
    total,
    page,
    page_size: pageSize,
    items: rows.map((c) => ({
      id: c.id,
      name: c.name || '访客',
      phone: c.phone_number ?? '',
      email: c.email ?? '',
      location: c.location ?? '',
      last_activity_at: c.last_activity_at?.toISOString() ?? null,
      last_note_at: lastNoteMap.get(c.id) ?? null,
      labels: c.contact_labels
        .filter((cl) => cl.label)
        .map((cl) => ({
          id: cl.label.id,
          title: cl.label.title ?? '',
          color: cl.label.color,
        })),
    })),
  };
}

export async function getCustomerDetail(prisma: PrismaClient, opts: { accountId: number; contactId: number }) {
  const c = await prisma.contacts.findFirst({
    where: { id: opts.contactId, account_id: opts.accountId },
    include: {
      company: { select: { id: true, name: true, domain: true, description: true } },
    },
  });
  if (!c) return null;

  const [conversations, labels, notes, opportunities, companyPeers] = await Promise.all([
    prisma.conversations.findMany({
      where: { contact_id: c.id, account_id: opts.accountId },
      orderBy: { last_activity_at: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        created_at: true,
        last_activity_at: true,
        inbox_id: true,
        assignee_id: true,
      },
    }),
    loadContactLabels(prisma, c.id),
    prisma.notes.findMany({
      where: { contact_id: c.id, account_id: opts.accountId },
      orderBy: { created_at: 'desc' },
      take: 50,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.opportunities.findMany({
      where: { contact_id: c.id, account_id: opts.accountId },
      orderBy: { updated_at: 'desc' },
      take: 20,
    }),
    c.company_id
      ? prisma.contacts.findMany({
          where: {
            account_id: opts.accountId,
            company_id: c.company_id,
            id: { not: c.id },
          },
          orderBy: [{ last_activity_at: 'desc' }, { id: 'desc' }],
          take: 20,
          select: {
            id: true,
            name: true,
            phone_number: true,
            email: true,
            last_activity_at: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const phone = c.phone_number ?? '';
  const call_records = phone ? await listRecentCallsByPhone(phone, 10) : [];
  const attrs = attrsOf(c);

  return {
    id: c.id,
    name: c.name || '访客',
    phone,
    email: c.email ?? '',
    location: c.location ?? '',
    gender: pickAttr(attrs, 'gender', '未知'),
    customer_type: pickAttr(attrs, 'customer_type', '普通客户'),
    level: pickAttr(attrs, 'level', '普通'),
    id_number: pickAttr(attrs, 'id_number', ''),
    ethnicity: pickAttr(attrs, 'ethnicity', ''),
    company_id: c.company_id,
    company: c.company
      ? {
          id: c.company.id,
          name: c.company.name,
          domain: c.company.domain ?? '',
          description: c.company.description ?? '',
        }
      : null,
    company_contacts: companyPeers.map((p) => ({
      id: p.id,
      name: p.name || '访客',
      phone: p.phone_number ?? '',
      email: p.email ?? '',
      last_activity_at: p.last_activity_at?.toISOString() ?? null,
    })),
    custom_attributes: attrs,
    labels,
    notes: notes.map((n) => ({
      id: n.id,
      content: n.content,
      user_id: n.user_id,
      user_name: n.user?.name ?? '',
      created_at: n.created_at.toISOString(),
    })),
    opportunities: opportunities.map((o) => ({
      id: o.id,
      title: o.title,
      stage: o.stage,
      amount: o.amount,
      currency: o.currency,
      status: o.status,
      expected_close: o.expected_close?.toISOString() ?? null,
      updated_at: o.updated_at.toISOString(),
    })),
    conversations: conversations.map((cv) => ({
      id: `c${cv.id}`,
      status: cv.status,
      created_at: cv.created_at?.toISOString() ?? null,
      last_activity_at: cv.last_activity_at?.toISOString() ?? null,
      inbox_id: cv.inbox_id,
      assignee_id: cv.assignee_id,
    })),
    call_records,
  };
}

export async function patchCustomer(
  prisma: PrismaClient,
  opts: {
    accountId: number;
    contactId: number;
    body: {
      name?: string;
      phone?: string;
      email?: string | null;
      location?: string;
      gender?: string;
      customer_type?: string;
      level?: string;
      id_number?: string;
      ethnicity?: string;
      company_id?: number | null;
      custom_attributes?: Record<string, unknown>;
    };
  },
) {
  const existing = await prisma.contacts.findFirst({
    where: { id: opts.contactId, account_id: opts.accountId },
  });
  if (!existing) return null;

  const prev = attrsOf(existing);
  const nextAttrs: Record<string, unknown> = {
    ...prev,
    ...(opts.body.custom_attributes ?? {}),
  };
  if (opts.body.gender !== undefined) nextAttrs.gender = opts.body.gender;
  if (opts.body.customer_type !== undefined) nextAttrs.customer_type = opts.body.customer_type;
  if (opts.body.level !== undefined) nextAttrs.level = opts.body.level;
  if (opts.body.id_number !== undefined) nextAttrs.id_number = opts.body.id_number;
  if (opts.body.ethnicity !== undefined) nextAttrs.ethnicity = opts.body.ethnicity;

  await prisma.contacts.update({
    where: { id: opts.contactId },
    data: {
      ...(opts.body.name !== undefined && { name: opts.body.name.trim() }),
      ...(opts.body.phone !== undefined && { phone_number: opts.body.phone.trim() || null }),
      ...(opts.body.email !== undefined && { email: opts.body.email?.trim() || null }),
      ...(opts.body.location !== undefined && { location: opts.body.location.trim() }),
      ...(opts.body.company_id !== undefined && { company_id: opts.body.company_id }),
      custom_attributes: nextAttrs as object,
      last_activity_at: new Date(),
    },
  });

  if (opts.body.company_id !== undefined) {
    const ids = [existing.company_id, opts.body.company_id].filter(
      (x): x is number => typeof x === 'number' && Number.isFinite(x),
    );
    for (const cid of [...new Set(ids)]) {
      const count = await prisma.contacts.count({
        where: { account_id: opts.accountId, company_id: cid },
      });
      await prisma.companies.update({
        where: { id: cid },
        data: { contacts_count: count },
      }).catch(() => undefined);
    }
  }

  return getCustomerDetail(prisma, { accountId: opts.accountId, contactId: opts.contactId });
}

export async function listCustomerNotes(
  prisma: PrismaClient,
  opts: { accountId: number; contactId: number },
) {
  const rows = await prisma.notes.findMany({
    where: { contact_id: opts.contactId, account_id: opts.accountId },
    orderBy: { created_at: 'desc' },
    take: 100,
    include: { user: { select: { id: true, name: true } } },
  });
  return {
    items: rows.map((n) => ({
      id: n.id,
      content: n.content,
      user_id: n.user_id,
      user_name: n.user?.name ?? '',
      created_at: n.created_at.toISOString(),
    })),
  };
}

export async function createCustomerNote(
  prisma: PrismaClient,
  opts: { accountId: number; contactId: number; userId: number; content: string },
) {
  const contact = await prisma.contacts.findFirst({
    where: { id: opts.contactId, account_id: opts.accountId },
    select: { id: true },
  });
  if (!contact) return null;
  const row = await prisma.notes.create({
    data: {
      account_id: opts.accountId,
      contact_id: opts.contactId,
      user_id: opts.userId,
      content: opts.content.trim(),
    },
    include: { user: { select: { id: true, name: true } } },
  });
  await prisma.contacts.update({
    where: { id: opts.contactId },
    data: { last_activity_at: new Date() },
  });
  return {
    id: row.id,
    content: row.content,
    user_id: row.user_id,
    user_name: row.user?.name ?? '',
    created_at: row.created_at.toISOString(),
  };
}

export async function deleteCustomerNote(
  prisma: PrismaClient,
  opts: { accountId: number; contactId: number; noteId: number },
) {
  const note = await prisma.notes.findFirst({
    where: { id: opts.noteId, contact_id: opts.contactId, account_id: opts.accountId },
  });
  if (!note) return false;
  await prisma.notes.delete({ where: { id: opts.noteId } });
  return true;
}

export async function getCustomerLabels(
  prisma: PrismaClient,
  opts: { accountId: number; contactId: number },
) {
  const contact = await prisma.contacts.findFirst({
    where: { id: opts.contactId, account_id: opts.accountId },
    select: { id: true },
  });
  if (!contact) return null;
  return { items: await loadContactLabels(prisma, opts.contactId) };
}

export async function putCustomerLabels(
  prisma: PrismaClient,
  opts: { accountId: number; contactId: number; labelIds: number[] },
) {
  const contact = await prisma.contacts.findFirst({
    where: { id: opts.contactId, account_id: opts.accountId },
    select: { id: true },
  });
  if (!contact) return null;

  const uniqueIds = [...new Set(opts.labelIds.filter((id) => Number.isFinite(id)))];
  const valid = uniqueIds.length
    ? await prisma.labels.findMany({
        where: { id: { in: uniqueIds }, account_id: opts.accountId },
        select: { id: true },
      })
    : [];
  const validIds = valid.map((l) => l.id);

  await prisma.$transaction([
    prisma.contact_labels.deleteMany({ where: { contact_id: opts.contactId } }),
    ...(validIds.length
      ? [
          prisma.contact_labels.createMany({
            data: validIds.map((label_id) => ({
              contact_id: opts.contactId,
              label_id,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);

  return { items: await loadContactLabels(prisma, opts.contactId) };
}

export async function listCrmLabels(prisma: PrismaClient, accountId: number) {
  let rows = await prisma.labels.findMany({
    where: { account_id: accountId },
    orderBy: { title: 'asc' },
  });
  if (rows.length === 0) {
    await prisma.labels.createMany({
      data: [
        { account_id: accountId, title: '重要客户', color: '#f56c6c' },
        { account_id: accountId, title: '待回访', color: '#e6a23c' },
        { account_id: accountId, title: 'VIP', color: '#409eff' },
      ],
      skipDuplicates: true,
    });
    rows = await prisma.labels.findMany({
      where: { account_id: accountId },
      orderBy: { title: 'asc' },
    });
  }
  return {
    items: rows.map((l) => ({
      id: l.id,
      title: l.title ?? '',
      color: l.color,
      description: l.description ?? '',
    })),
  };
}

export async function getCustomerTimeline(
  prisma: PrismaClient,
  opts: { accountId: number; contactId: number; limit?: number },
): Promise<{ items: TimelineItem[] } | null> {
  const c = await prisma.contacts.findFirst({
    where: { id: opts.contactId, account_id: opts.accountId },
    select: { id: true, phone_number: true, name: true },
  });
  if (!c) return null;

  const limit = Math.min(100, Math.max(10, opts.limit ?? 50));
  const [conversations, notes] = await Promise.all([
    prisma.conversations.findMany({
      where: { contact_id: c.id, account_id: opts.accountId },
      orderBy: { last_activity_at: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        created_at: true,
        last_activity_at: true,
      },
    }),
    prisma.notes.findMany({
      where: { contact_id: c.id, account_id: opts.accountId },
      orderBy: { created_at: 'desc' },
      take: limit,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const calls = c.phone_number ? await listRecentCallsByPhone(c.phone_number, limit) : [];
  const items: TimelineItem[] = [];

  for (const cv of conversations) {
    const at = (cv.last_activity_at ?? cv.created_at)?.toISOString() ?? new Date().toISOString();
    items.push({
      id: `conv-${cv.id}`,
      type: 'conversation',
      at,
      title: cv.status === 0 ? '进行中会话' : '已结束会话',
      summary: `会话 #${cv.id}`,
      meta: { conversation_id: cv.id, status: cv.status },
    });
  }
  for (const n of notes) {
    items.push({
      id: `note-${n.id}`,
      type: 'note',
      at: n.created_at.toISOString(),
      title: '跟进备注',
      summary: n.content.slice(0, 200),
      meta: { note_id: n.id, user_name: n.user?.name ?? '' },
    });
  }
  for (const call of calls) {
    items.push({
      id: `call-${call.begin_time}-${call.caller}-${call.called}`,
      type: 'call',
      at: call.begin_time ? new Date(call.begin_time.replace(' ', 'T')).toISOString() : new Date().toISOString(),
      title: '话务通话',
      summary: `${call.caller || '?'} → ${call.called || '?'} · ${call.talk_sec}s`,
      meta: { ...call },
    });
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { items: items.slice(0, limit) };
}

export async function listCompanies(
  prisma: PrismaClient,
  opts: { accountId: number; q?: string },
) {
  const q = opts.q?.trim() ?? '';
  const rows = await prisma.companies.findMany({
    where: {
      account_id: opts.accountId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { domain: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    take: 100,
  });
  return {
    items: rows.map((c) => ({
      id: c.id,
      name: c.name,
      domain: c.domain ?? '',
      description: c.description ?? '',
      contacts_count: c.contacts_count ?? 0,
    })),
  };
}

export async function createCompany(
  prisma: PrismaClient,
  opts: { accountId: number; name: string; domain?: string; description?: string },
) {
  const row = await prisma.companies.create({
    data: {
      account_id: opts.accountId,
      name: opts.name.trim(),
      domain: opts.domain?.trim() || null,
      description: opts.description?.trim() || null,
      contacts_count: 0,
    },
  });
  return {
    id: row.id,
    name: row.name,
    domain: row.domain ?? '',
    description: row.description ?? '',
  };
}

export async function patchCompany(
  prisma: PrismaClient,
  opts: {
    accountId: number;
    companyId: number;
    body: { name?: string; domain?: string | null; description?: string | null };
  },
) {
  const existing = await prisma.companies.findFirst({
    where: { id: opts.companyId, account_id: opts.accountId },
  });
  if (!existing) return null;
  const row = await prisma.companies.update({
    where: { id: opts.companyId },
    data: {
      ...(opts.body.name !== undefined && { name: opts.body.name.trim() }),
      ...(opts.body.domain !== undefined && { domain: opts.body.domain?.trim() || null }),
      ...(opts.body.description !== undefined && {
        description: opts.body.description?.trim() || null,
      }),
    },
  });
  return {
    id: row.id,
    name: row.name,
    domain: row.domain ?? '',
    description: row.description ?? '',
  };
}

/** 删除公司：先解除联系人关联；商机 company_id 由 FK SetNull */
export async function deleteCompany(
  prisma: PrismaClient,
  opts: { accountId: number; companyId: number },
) {
  const existing = await prisma.companies.findFirst({
    where: { id: opts.companyId, account_id: opts.accountId },
  });
  if (!existing) return false;

  await prisma.$transaction([
    prisma.contacts.updateMany({
      where: { account_id: opts.accountId, company_id: opts.companyId },
      data: { company_id: null },
    }),
    prisma.companies.delete({ where: { id: opts.companyId } }),
  ]);
  return true;
}

export async function getCompanyDetail(
  prisma: PrismaClient,
  opts: { accountId: number; companyId: number; excludeContactId?: number },
) {
  const company = await prisma.companies.findFirst({
    where: { id: opts.companyId, account_id: opts.accountId },
  });
  if (!company) return null;

  const contacts = await prisma.contacts.findMany({
    where: {
      account_id: opts.accountId,
      company_id: opts.companyId,
      ...(opts.excludeContactId != null ? { id: { not: opts.excludeContactId } } : {}),
    },
    orderBy: [{ last_activity_at: 'desc' }, { id: 'desc' }],
    take: 50,
    select: {
      id: true,
      name: true,
      phone_number: true,
      email: true,
      last_activity_at: true,
    },
  });

  const count = await prisma.contacts.count({
    where: { account_id: opts.accountId, company_id: opts.companyId },
  });
  if ((company.contacts_count ?? 0) !== count) {
    await prisma.companies.update({
      where: { id: company.id },
      data: { contacts_count: count },
    });
  }

  return {
    id: company.id,
    name: company.name,
    domain: company.domain ?? '',
    description: company.description ?? '',
    contacts_count: count,
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.name || '访客',
      phone: c.phone_number ?? '',
      email: c.email ?? '',
      last_activity_at: c.last_activity_at?.toISOString() ?? null,
    })),
  };
}

export async function listOpportunities(
  prisma: PrismaClient,
  opts: { accountId: number; contactId?: number; companyId?: number },
) {
  const rows = await prisma.opportunities.findMany({
    where: {
      account_id: opts.accountId,
      ...(opts.contactId != null ? { contact_id: opts.contactId } : {}),
      ...(opts.companyId != null ? { company_id: opts.companyId } : {}),
    },
    orderBy: { updated_at: 'desc' },
    take: 200,
    include: {
      contact: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
    },
  });
  return {
    items: rows.map((o) => ({
      id: o.id,
      title: o.title,
      stage: o.stage,
      amount: o.amount,
      currency: o.currency,
      status: o.status,
      contact_id: o.contact_id,
      company_id: o.company_id,
      contact_name: o.contact?.name ?? '',
      company_name: o.company?.name ?? '',
      expected_close: o.expected_close?.toISOString() ?? null,
      updated_at: o.updated_at.toISOString(),
    })),
  };
}

export async function createOpportunity(
  prisma: PrismaClient,
  opts: {
    accountId: number;
    ownerId: number;
    title: string;
    stage?: string;
    amount?: number | null;
    contactId?: number | null;
    companyId?: number | null;
    expectedClose?: string | null;
  },
) {
  const row = await prisma.opportunities.create({
    data: {
      account_id: opts.accountId,
      owner_id: opts.ownerId,
      title: opts.title.trim(),
      stage: opts.stage || 'new',
      amount: opts.amount ?? null,
      contact_id: opts.contactId ?? null,
      company_id: opts.companyId ?? null,
      expected_close: opts.expectedClose ? new Date(opts.expectedClose) : null,
    },
  });
  return {
    id: row.id,
    title: row.title,
    stage: row.stage,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    contact_id: row.contact_id,
    company_id: row.company_id,
    expected_close: row.expected_close?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
  };
}

export async function patchOpportunity(
  prisma: PrismaClient,
  opts: {
    accountId: number;
    id: number;
    body: {
      title?: string;
      stage?: string;
      amount?: number | null;
      status?: string;
      expected_close?: string | null;
    };
  },
) {
  const existing = await prisma.opportunities.findFirst({
    where: { id: opts.id, account_id: opts.accountId },
  });
  if (!existing) return null;
  const row = await prisma.opportunities.update({
    where: { id: opts.id },
    data: {
      ...(opts.body.title !== undefined && { title: opts.body.title.trim() }),
      ...(opts.body.stage !== undefined && { stage: opts.body.stage }),
      ...(opts.body.amount !== undefined && { amount: opts.body.amount }),
      ...(opts.body.status !== undefined && { status: opts.body.status }),
      ...(opts.body.expected_close !== undefined && {
        expected_close: opts.body.expected_close ? new Date(opts.body.expected_close) : null,
      }),
    },
  });
  return {
    id: row.id,
    title: row.title,
    stage: row.stage,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    contact_id: row.contact_id,
    company_id: row.company_id,
    expected_close: row.expected_close?.toISOString() ?? null,
    updated_at: row.updated_at.toISOString(),
  };
}

export async function deleteOpportunity(
  prisma: PrismaClient,
  opts: { accountId: number; id: number },
) {
  const existing = await prisma.opportunities.findFirst({
    where: { id: opts.id, account_id: opts.accountId },
  });
  if (!existing) return false;
  await prisma.opportunities.delete({ where: { id: opts.id } });
  return true;
}
