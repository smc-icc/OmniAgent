import type { FastifyInstance } from 'fastify';
import {
  listContacts, createContact, showContact, updateContact, destroyContact,
  activeContacts, searchContacts, filterContacts, importContacts, exportContacts,
  deleteContactAvatar, contactableInboxes, destroyCustomAttributes,
  listCompanies, createCompany, showCompany, updateCompany, destroyCompany, searchCompanies,
  createContactInbox,
  listContactNotes, createContactNote, destroyContactNote,
  addContactLabels, listContactLabels,
  listContactConversations,
  listCustomAttrDefs, createCustomAttrDef, showCustomAttrDef, updateCustomAttrDef, destroyCustomAttrDef,
  bulkActions, contactMerge, contactInboxFilter,
} from './contacts.controller.js';

export async function contactsRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };
  const base = '/api/v1/accounts/:account_id';

  // ── Contacts ──
  fastify.get(`${base}/contacts`, auth, listContacts);
  fastify.post(`${base}/contacts`, auth, createContact);
  fastify.get(`${base}/contacts/active`, auth, activeContacts);
  fastify.get(`${base}/contacts/search`, auth, searchContacts);
  fastify.post(`${base}/contacts/filter`, auth, filterContacts);
  fastify.post(`${base}/contacts/import`, auth, importContacts);
  fastify.post(`${base}/contacts/export`, auth, exportContacts);
  fastify.get(`${base}/contacts/:id`, auth, showContact);
  fastify.put(`${base}/contacts/:id`, auth, updateContact);
  fastify.delete(`${base}/contacts/:id`, auth, destroyContact);
  fastify.delete(`${base}/contacts/:id/avatar`, auth, deleteContactAvatar);
  fastify.get(`${base}/contacts/:id/contactable_inboxes`, auth, contactableInboxes);
  fastify.post(`${base}/contacts/:id/destroy_custom_attributes`, auth, destroyCustomAttributes);

  // ── Companies ──
  fastify.get(`${base}/companies`, auth, listCompanies);
  fastify.post(`${base}/companies`, auth, createCompany);
  fastify.get(`${base}/companies/search`, auth, searchCompanies);
  fastify.get(`${base}/companies/:id`, auth, showCompany);
  fastify.put(`${base}/companies/:id`, auth, updateCompany);
  fastify.delete(`${base}/companies/:id`, auth, destroyCompany);

  // ── Contact Inboxes ──
  fastify.post(`${base}/contacts/:contact_id/contact_inboxes`, auth, createContactInbox);

  // ── Contact Notes ──
  fastify.get(`${base}/contacts/:contact_id/notes`, auth, listContactNotes);
  fastify.post(`${base}/contacts/:contact_id/notes`, auth, createContactNote);
  fastify.delete(`${base}/contacts/:contact_id/notes/:id`, auth, destroyContactNote);

  // ── Contact Labels ──
  fastify.post(`${base}/contacts/:contact_id/labels`, auth, addContactLabels);
  fastify.get(`${base}/contacts/:contact_id/labels`, auth, listContactLabels);

  // ── Contact Conversations ──
  fastify.get(`${base}/contacts/:contact_id/conversations`, auth, listContactConversations);

  // ── Custom Attribute Definitions ──
  fastify.get(`${base}/custom_attribute_definitions`, auth, listCustomAttrDefs);
  fastify.post(`${base}/custom_attribute_definitions`, auth, createCustomAttrDef);
  fastify.get(`${base}/custom_attribute_definitions/:id`, auth, showCustomAttrDef);
  fastify.put(`${base}/custom_attribute_definitions/:id`, auth, updateCustomAttrDef);
  fastify.delete(`${base}/custom_attribute_definitions/:id`, auth, destroyCustomAttrDef);

  // ── Contact Inboxes Filter ──
  fastify.post(`${base}/contact_inboxes/filter`, auth, contactInboxFilter);

  // ── Bulk Actions ──
  fastify.post(`${base}/bulk_actions`, auth, bulkActions);
  fastify.post(`${base}/actions/contact_merge`, auth, contactMerge);
}
