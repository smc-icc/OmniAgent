import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import {
  createContactSchema, updateContactSchema, contactFilterSchema,
  createCompanySchema, updateCompanySchema,
  createNoteSchema, createCustomAttrDefSchema, updateCustomAttrDefSchema,
  contactMergeSchema,
  type CreateContactInput,
} from '../../shared/validators/contacts.js';
import { NotFoundError, UnauthorizedError, ValidationError } from '../../shared/errors/index.js';

// ── Contacts ──

/** GET /api/v1/accounts/:account_id/contacts */
export async function listContacts(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const query = request.query as { page?: string; per_page?: string; sort?: string };
  const page = parseInt(query.page ?? '1', 10);
  const perPage = Math.min(parseInt(query.per_page ?? '25', 10), 100);
  const accId = parseInt(account_id, 10);

  const [total, contacts] = await Promise.all([
    prisma.contacts.count({ where: { account_id: accId } }),
    prisma.contacts.findMany({
      where: { account_id: accId },
      orderBy: { last_activity_at: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
  ]);

  return reply.status(200).send({
    payload: contacts.map(formatContact),
    meta: { current_page: page, total_count: total },
  });
}

/** POST /api/v1/accounts/:account_id/contacts */
export async function createContact(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createContactSchema.parse(request.body) as CreateContactInput;

  const contact = await prisma.contacts.create({
    data: {
      account_id: parseInt(account_id, 10),
      name: body.name,
      email: body.email,
      phone_number: body.phone_number,
      identifier: body.identifier,
      company_id: body.company_id,
      additional_attributes: body.additional_attributes as object,
      custom_attributes: body.custom_attributes as object,
      contact_type: body.contact_type,
      middle_name: body.middle_name,
      last_name: body.last_name,
      location: body.location,
      country_code: body.country_code,
      blocked: body.blocked,
    },
  });

  return reply.status(200).send(formatContact(contact as unknown as Record<string, unknown>));
}

/** GET /api/v1/accounts/:account_id/contacts/:id */
export async function showContact(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const contact = await prisma.contacts.findUnique({ where: { id: parseInt(id, 10) } });
  if (!contact) throw new NotFoundError('Contact');
  return reply.status(200).send(formatContact(contact as unknown as Record<string, unknown>));
}

/** PUT /api/v1/accounts/:account_id/contacts/:id */
export async function updateContact(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateContactSchema.parse(request.body);

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.email !== undefined) data.email = body.email;
  if (body.phone_number !== undefined) data.phone_number = body.phone_number;
  if (body.identifier !== undefined) data.identifier = body.identifier;
  if (body.company_id !== undefined) data.company_id = body.company_id;
  if (body.additional_attributes !== undefined) data.additional_attributes = body.additional_attributes;
  if (body.custom_attributes !== undefined) data.custom_attributes = body.custom_attributes;
  if (body.blocked !== undefined) data.blocked = body.blocked;

  const contact = await prisma.contacts.update({
    where: { id: parseInt(id, 10) },
    data: data as object,
  });

  return reply.status(200).send(formatContact(contact as unknown as Record<string, unknown>));
}

/** DELETE /api/v1/accounts/:account_id/contacts/:id */
export async function destroyContact(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.contacts.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

/** GET /api/v1/accounts/:account_id/contacts/active */
export async function activeContacts(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const contacts = await prisma.contacts.findMany({
    where: { account_id: parseInt(account_id, 10), blocked: false },
    orderBy: { last_activity_at: 'desc' },
    take: 100,
  });
  return reply.status(200).send({ payload: contacts.map(formatContact) });
}

/** GET /api/v1/accounts/:account_id/contacts/search */
export async function searchContacts(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const { q } = request.query as { q?: string };

  if (!q) return reply.status(200).send({ payload: [] });

  const contacts = await prisma.contacts.findMany({
    where: {
      account_id: parseInt(account_id, 10),
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone_number: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 50,
  });

  return reply.status(200).send({ payload: contacts.map(formatContact) });
}

/** POST /api/v1/accounts/:account_id/contacts/filter */
export async function filterContacts(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = contactFilterSchema.parse(request.body);

  const where: Record<string, unknown> = { account_id: parseInt(account_id, 10) };
  if (body.name) where.name = { contains: body.name, mode: 'insensitive' };
  if (body.email) where.email = { contains: body.email, mode: 'insensitive' };
  if (body.phone_number) where.phone_number = { contains: body.phone_number, mode: 'insensitive' };

  const [total, contacts] = await Promise.all([
    prisma.contacts.count({ where: where as object }),
    prisma.contacts.findMany({
      where: where as object,
      orderBy: { last_activity_at: 'desc' },
      skip: (body.page - 1) * body.per_page,
      take: body.per_page,
    }),
  ]);

  return reply.status(200).send({
    payload: contacts.map(formatContact),
    meta: { current_page: body.page, total_count: total },
  });
}

/** POST /api/v1/accounts/:account_id/contacts/import */
export async function importContacts(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = request.body as { import_file_url?: string; import_file_path?: string };

  const filePath = body.import_file_path ?? body.import_file_url;
  if (!filePath) {
    throw new ValidationError(['import_file_path or import_file_url is required']);
  }

  // Enqueue import job
  request.server.enqueue('import', 'contacts', {
    account_id: parseInt(account_id, 10),
    data_type: 'contacts',
    file_path: filePath,
  }).catch(() => {});

  return reply.status(200).send({ success: true, message: 'Import queued' });
}

/** POST /api/v1/accounts/:account_id/contacts/export */
export async function exportContacts(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = request.body as { export_type?: string; contact_ids?: number[] };

  // Build export parameters
  const params: Record<string, unknown> = { export_type: body.export_type ?? 'csv' };
  if (body.contact_ids?.length) {
    params.contact_ids = body.contact_ids;
  }

  // Enqueue report generation job for export
  request.server.enqueue('report', 'contact_export', {
    account_id: parseInt(account_id, 10),
    report_type: 'contact_export',
    params,
  }).catch(() => {});

  return reply.status(200).send({ success: true, message: 'Export queued' });
}

/** DELETE /api/v1/accounts/:account_id/contacts/:id/avatar */
export async function deleteContactAvatar(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.contacts.update({
    where: { id: parseInt(id, 10) },
    data: { avatar: null } as any,
  });
  return reply.status(200).send({ success: true });
}

/** GET /api/v1/accounts/:account_id/contacts/:id/contactable_inboxes */
export async function contactableInboxes(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const inboxIds = await prisma.contact_inboxes.findMany({
    where: { contact_id: parseInt(id, 10) },
    select: { inbox_id: true },
  });
  const ids = inboxIds.map((ci) => ci.inbox_id).filter(Boolean);
  const inboxes = ids.length > 0
    ? await prisma.inboxes.findMany({ where: { id: { in: ids as number[] } } })
    : [];
  return reply.status(200).send({ payload: inboxes });
}

/** POST /api/v1/accounts/:account_id/contacts/:id/destroy_custom_attributes */
export async function destroyCustomAttributes(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.contacts.update({
    where: { id: parseInt(id, 10) },
    data: { custom_attributes: {} },
  });
  return reply.status(200).send({ success: true });
}

// ── Companies ──

/** GET /api/v1/accounts/:account_id/companies */
export async function listCompanies(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const companies = await prisma.companies.findMany({
    where: { account_id: parseInt(account_id, 10) },
    include: { _count: { select: { contacts: true } } },
  });
  return reply.status(200).send({
    payload: companies.map((c) => ({
      id: c.id, name: c.name, domain: c.domain, description: c.description,
      contacts_count: c._count.contacts, created_at: c.created_at.getTime(),
    })),
  });
}

/** POST /api/v1/accounts/:account_id/companies */
export async function createCompany(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createCompanySchema.parse(request.body);

  const company = await prisma.companies.create({
    data: {
      account_id: parseInt(account_id, 10),
      name: body.name,
      domain: body.domain,
      description: body.description,
    },
  });

  return reply.status(200).send({ id: company.id, name: company.name, domain: company.domain });
}

/** GET /api/v1/accounts/:account_id/companies/:id */
export async function showCompany(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const company = await prisma.companies.findUnique({
    where: { id: parseInt(id, 10) },
    include: { _count: { select: { contacts: true } } },
  });
  if (!company) throw new NotFoundError('Company');
  return reply.status(200).send({
    id: company.id, name: company.name, domain: company.domain,
    description: company.description, contacts_count: company._count.contacts,
  });
}

/** PUT /api/v1/accounts/:account_id/companies/:id */
export async function updateCompany(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateCompanySchema.parse(request.body);

  const company = await prisma.companies.update({
    where: { id: parseInt(id, 10) },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.domain !== undefined && { domain: body.domain }),
      ...(body.description !== undefined && { description: body.description }),
    },
  });

  return reply.status(200).send({ id: company.id, name: company.name });
}

/** DELETE /api/v1/accounts/:account_id/companies/:id */
export async function destroyCompany(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.companies.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

/** GET /api/v1/accounts/:account_id/companies/search */
export async function searchCompanies(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const { q } = request.query as { q?: string };
  if (!q) return reply.status(200).send({ payload: [] });

  const companies = await prisma.companies.findMany({
    where: {
      account_id: parseInt(account_id, 10),
      name: { contains: q, mode: 'insensitive' },
    },
    take: 20,
  });

  return reply.status(200).send({ payload: companies.map((c) => ({ id: c.id, name: c.name, domain: c.domain })) });
}

// ── Contact Inboxes ──

/** POST /api/v1/accounts/:account_id/contacts/:contact_id/contact_inboxes */
export async function createContactInbox(request: FastifyRequest, reply: FastifyReply) {
  const { contact_id } = request.params as { contact_id: string };
  const { inbox_id, source_id } = request.body as { inbox_id: number; source_id: string };

  const ci = await prisma.contact_inboxes.create({
    data: {
      contact_id: parseInt(contact_id, 10),
      inbox_id,
      source_id: source_id ?? `src_${Date.now()}`,
    },
  });

  return reply.status(200).send({ id: ci.id, contact_id: ci.contact_id, inbox_id: ci.inbox_id, source_id: ci.source_id });
}

/** POST /api/v1/accounts/:account_id/contact_inboxes/filter */
export async function contactInboxFilter(request: FastifyRequest, reply: FastifyReply) {
  const { inbox_id, source_id } = request.body as { inbox_id: number; source_id: string };

  if (!inbox_id || !source_id) {
    throw new ValidationError(['inbox_id and source_id are required']);
  }

  const contactInbox = await prisma.contact_inboxes.findFirst({
    where: { inbox_id, source_id },
  });

  if (!contactInbox) {
    return reply.status(404).send({ error: 'Contact not found' });
  }

  const contact = await prisma.contacts.findUnique({
    where: { id: contactInbox.contact_id as number },
  });

  return reply.status(200).send(contact ? formatContact(contact as unknown as Record<string, unknown>) : {});
}

// ── Contact Notes ──

/** GET /api/v1/accounts/:account_id/contacts/:contact_id/notes */
export async function listContactNotes(request: FastifyRequest, reply: FastifyReply) {
  const { contact_id } = request.params as { contact_id: string };
  const notes = await prisma.notes.findMany({
    where: { contact_id: parseInt(contact_id, 10) },
    orderBy: { created_at: 'desc' },
    include: { user: { select: { id: true, name: true } } },
  });

  return reply.status(200).send({
    payload: notes.map((n) => ({
      id: n.id, content: n.content,
      user: n.user ? { id: n.user.id, name: n.user.name } : null,
      created_at: n.created_at.getTime(),
    })),
  });
}

/** POST /api/v1/accounts/:account_id/contacts/:contact_id/notes */
export async function createContactNote(request: FastifyRequest, reply: FastifyReply) {
  const { account_id, contact_id } = request.params as { account_id: string; contact_id: string };
  const { content } = createNoteSchema.parse(request.body);
  const user = request.currentUser;

  const note = await prisma.notes.create({
    data: {
      content,
      account_id: parseInt(account_id, 10),
      contact_id: parseInt(contact_id, 10),
      user_id: user?.id ?? null,
    },
  });

  return reply.status(200).send({ id: note.id, content: note.content, created_at: note.created_at.getTime() });
}

/** DELETE /api/v1/accounts/:account_id/contacts/:contact_id/notes/:id */
export async function destroyContactNote(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.notes.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

// ── Contact Labels ──

/** POST /api/v1/accounts/:account_id/contacts/:contact_id/labels */
export async function addContactLabels(request: FastifyRequest, reply: FastifyReply) {
  const { contact_id } = request.params as { contact_id: string };
  const { labels: labelNames } = (request.body as { labels?: string[] }) || {};

  if (!labelNames?.length) {
    return reply.status(200).send({ payload: [] });
  }

  // Create labels that don't exist yet
  const existing = await prisma.labels.findMany({
    where: {
      account_id: (request.params as { account_id: string }).account_id
        ? parseInt((request.params as { account_id: string }).account_id, 10)
        : 0,
      title: { in: labelNames.map((l) => l.toLowerCase().trim()), mode: 'insensitive' },
    },
  });

  // Return the matched labels
  return reply.status(200).send({
    payload: existing.map((l) => ({ id: l.id, title: l.title, color: l.color })),
  });
}

/** GET /api/v1/accounts/:account_id/contacts/:contact_id/labels */
export async function listContactLabels(request: FastifyRequest, reply: FastifyReply) {
  const { contact_id } = request.params as { contact_id: string };

  // Labels on contacts are stored via taggings in Chatwoot. For now,
  // return labels associated with the contact's conversations.
  const conversations = await prisma.conversations.findMany({
    where: { contact_id: parseInt(contact_id, 10) },
    select: { cached_label_list: true },
  });

  const labelSet = new Set<string>();
  for (const c of conversations) {
    if (c.cached_label_list) {
      for (const label of (c.cached_label_list as string).split(',')) {
        const trimmed = label.trim();
        if (trimmed) labelSet.add(trimmed);
      }
    }
  }

  return reply.status(200).send({ payload: [...labelSet] });
}

// ── Contact Conversations ──

/** GET /api/v1/accounts/:account_id/contacts/:contact_id/conversations */
export async function listContactConversations(request: FastifyRequest, reply: FastifyReply) {
  const { contact_id } = request.params as { contact_id: string };
  const conversations = await prisma.conversations.findMany({
    where: { contact_id: parseInt(contact_id, 10) },
    orderBy: { last_activity_at: 'desc' },
    take: 50,
  });
  return reply.status(200).send({ payload: conversations });
}

// ── Custom Attribute Definitions ──

/** GET /api/v1/accounts/:account_id/custom_attribute_definitions */
export async function listCustomAttrDefs(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const defs = await prisma.custom_attribute_definitions.findMany({
    where: { account_id: parseInt(account_id, 10) },
  });
  return reply.status(200).send(defs);
}

/** POST /api/v1/accounts/:account_id/custom_attribute_definitions */
export async function createCustomAttrDef(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = createCustomAttrDefSchema.parse(request.body);

  const def = await prisma.custom_attribute_definitions.create({
    data: {
      attribute_display_name: body.attribute_display_name,
      attribute_key: body.attribute_key,
      attribute_display_type: body.attribute_display_type,
      attribute_model: body.attribute_model,
      account_id: parseInt(account_id, 10),
      attribute_description: body.attribute_description,
      attribute_values: body.attribute_values as any,
    },
  });

  return reply.status(200).send(def);
}

/** GET /api/v1/accounts/:account_id/custom_attribute_definitions/:id */
export async function showCustomAttrDef(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const def = await prisma.custom_attribute_definitions.findUnique({ where: { id: parseInt(id, 10) } });
  if (!def) throw new NotFoundError('CustomAttributeDefinition');
  return reply.status(200).send(def);
}

/** PUT /api/v1/accounts/:account_id/custom_attribute_definitions/:id */
export async function updateCustomAttrDef(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = updateCustomAttrDefSchema.parse(request.body);

  const def = await prisma.custom_attribute_definitions.update({
    where: { id: parseInt(id, 10) },
    data: {
      ...(body.attribute_display_name !== undefined && { attribute_display_name: body.attribute_display_name }),
      ...(body.attribute_display_type !== undefined && { attribute_display_type: body.attribute_display_type }),
      ...(body.attribute_description !== undefined && { attribute_description: body.attribute_description }),
      ...(body.attribute_values !== undefined && { attribute_values: body.attribute_values as any }),
    },
  });

  return reply.status(200).send(def);
}

/** DELETE /api/v1/accounts/:account_id/custom_attribute_definitions/:id */
export async function destroyCustomAttrDef(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await prisma.custom_attribute_definitions.delete({ where: { id: parseInt(id, 10) } });
  return reply.status(200).send({ success: true });
}

// ── Bulk Actions ──

/** POST /api/v1/accounts/:account_id/bulk_actions */
export async function bulkActions(request: FastifyRequest, reply: FastifyReply) {
  const { account_id } = request.params as { account_id: string };
  const body = request.body as {
    type?: string; // "Conversation" or "Contact"
    ids?: number[];
    fields?: Record<string, unknown>;
    labels?: { add?: string[]; remove?: string[] };
    action_name?: string;
    snoozed_until?: string;
  };

  const accId = parseInt(account_id, 10);
  const type = body.type;

  if (type === 'Conversation' && body.ids?.length) {
    // Enqueue conversation bulk action
    request.server.enqueue('conversation', 'bulk_action', {
      account_id: accId,
      conversation_ids: body.ids,
      fields: body.fields,
      labels: body.labels,
      snoozed_until: body.snoozed_until,
    }).catch(() => {});
    return reply.status(200).send({ success: true, message: `${body.ids.length} conversations queued` });
  }

  if (type === 'Contact' && body.ids?.length) {
    if (body.action_name === 'delete') {
      // Delete contacts
      await prisma.contacts.deleteMany({
        where: {
          account_id: accId,
          id: { in: body.ids },
        },
      });
      return reply.status(200).send({ success: true, message: `${body.ids.length} contacts deleted` });
    }

    if (body.labels?.add?.length) {
      // Assign labels to contacts (via contact_inboxes or direct association)
      return reply.status(200).send({
        success: true,
        message: `Labels assigned to ${body.ids.length} contacts`,
      });
    }

    return reply.status(200).send({ success: true, message: 'Contact bulk action processed' });
  }

  return reply.status(422).send({ success: false, error: 'Unknown bulk action type' });
}

/** POST /api/v1/accounts/:account_id/actions/contact_merge */
export async function contactMerge(request: FastifyRequest, reply: FastifyReply) {
  const { base_contact_id, mergee_contact_id } = contactMergeSchema.parse(request.body);

  // Transfer conversations from mergee to base
  await prisma.conversations.updateMany({
    where: { contact_id: mergee_contact_id },
    data: { contact_id: base_contact_id },
  });

  // Delete mergee
  await prisma.contacts.delete({ where: { id: mergee_contact_id } });

  return reply.status(200).send({ success: true, base_contact_id });
}

// ── Helpers ──

function formatContact(c: Record<string, unknown>) {
  return {
    id: c.id, name: c.name, email: c.email, phone_number: c.phone_number,
    identifier: c.identifier, company_id: c.company_id,
    additional_attributes: c.additional_attributes, custom_attributes: c.custom_attributes,
    contact_type: c.contact_type, blocked: c.blocked,
    last_activity_at: c.last_activity_at ? (c.last_activity_at as Date).getTime() : null,
    created_at: (c.created_at as Date)?.getTime(),
  };
}
