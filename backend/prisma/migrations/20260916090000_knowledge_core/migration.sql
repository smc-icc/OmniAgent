CREATE TABLE knowledge_connections (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id INTEGER NOT NULL, vdn_id INTEGER NOT NULL, provider TEXT NOT NULL,
  base_url TEXT NOT NULL, credential_ref TEXT NOT NULL, external_tenant_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active', contract_version TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_connections_key UNIQUE (account_id, vdn_id, provider)
);
CREATE INDEX knowledge_connections_scope_idx ON knowledge_connections(account_id, vdn_id, state);

CREATE TABLE knowledge_bases (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id INTEGER NOT NULL, vdn_id INTEGER NOT NULL, name TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL, department_id INTEGER, agent_group_ids JSONB NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'active', acl_revision INTEGER NOT NULL DEFAULT 0,
  active_generation INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_bases_agent_groups_size CHECK (pg_column_size(agent_group_ids) <= 65536)
);
CREATE INDEX knowledge_bases_scope_idx ON knowledge_bases(account_id, vdn_id, state);
CREATE INDEX knowledge_bases_owner_idx ON knowledge_bases(owner_user_id);

CREATE TABLE knowledge_bindings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL REFERENCES knowledge_connections(id) ON DELETE RESTRICT,
  external_dataset_id TEXT NOT NULL, generation INTEGER NOT NULL,
  parser_profile JSONB NOT NULL DEFAULT '{}', embedding_model TEXT NOT NULL,
  config_hash TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_bindings_connection_dataset_key UNIQUE(connection_id, external_dataset_id),
  CONSTRAINT knowledge_bindings_generation_key UNIQUE(base_id, generation),
  CONSTRAINT knowledge_bindings_parser_size CHECK (pg_column_size(parser_profile) <= 65536)
);
CREATE INDEX knowledge_bindings_scope_idx ON knowledge_bindings(base_id, state);

CREATE TABLE knowledge_documents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id INTEGER NOT NULL, vdn_id INTEGER NOT NULL,
  base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL, source_id TEXT NOT NULL, title TEXT NOT NULL,
  category TEXT NOT NULL, tags JSONB NOT NULL DEFAULT '[]', owner_user_id INTEGER NOT NULL,
  acl_mode TEXT NOT NULL DEFAULT 'inherit', state TEXT NOT NULL DEFAULT 'draft',
  active_version_id TEXT, audience TEXT NOT NULL DEFAULT 'internal',
  valid_from TIMESTAMP(3), valid_to TIMESTAMP(3), deleted_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_documents_source_key UNIQUE(account_id, vdn_id, source_type, source_id),
  CONSTRAINT knowledge_documents_tags_size CHECK (pg_column_size(tags) <= 65536)
);
CREATE INDEX knowledge_documents_scope_idx ON knowledge_documents(account_id, vdn_id, state, audience, valid_to);
CREATE INDEX knowledge_documents_base_idx ON knowledge_documents(base_id, state);

CREATE TABLE knowledge_document_versions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL, binding_id TEXT NOT NULL REFERENCES knowledge_bindings(id) ON DELETE RESTRICT,
  external_document_id TEXT, content_sha256 TEXT NOT NULL, object_key TEXT, inline_content TEXT,
  parser_config_hash TEXT NOT NULL, index_state TEXT NOT NULL DEFAULT 'pending',
  review_state TEXT NOT NULL DEFAULT 'draft', chunk_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT, created_by INTEGER NOT NULL, reviewed_by INTEGER, reviewed_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_versions_number_key UNIQUE(document_id, version_no),
  CONSTRAINT knowledge_versions_external_key UNIQUE(binding_id, external_document_id),
  CONSTRAINT knowledge_versions_content_size CHECK (inline_content IS NULL OR octet_length(inline_content) <= 52428800)
);
CREATE INDEX knowledge_versions_state_idx ON knowledge_document_versions(document_id, index_state, review_state);
ALTER TABLE knowledge_documents ADD CONSTRAINT knowledge_documents_active_version_fk
  FOREIGN KEY(active_version_id) REFERENCES knowledge_document_versions(id) ON DELETE SET NULL;

CREATE TABLE knowledge_acl_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id INTEGER NOT NULL, vdn_id INTEGER NOT NULL,
  base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  document_id TEXT REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  capability TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX knowledge_acl_entries_key ON knowledge_acl_entries(account_id, vdn_id, base_id, COALESCE(document_id, ''), capability, subject_type, subject_id);
CREATE INDEX knowledge_acl_entries_scope_idx ON knowledge_acl_entries(account_id, vdn_id, capability, subject_type, subject_id);

CREATE TABLE knowledge_sync_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id INTEGER NOT NULL, vdn_id INTEGER NOT NULL, operation TEXT NOT NULL,
  document_id TEXT, version_id TEXT, binding_id TEXT, dedupe_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, locked_until TIMESTAMP(3),
  external_request_key TEXT, actor_user_id INTEGER, actor_kind TEXT NOT NULL DEFAULT 'user',
  payload JSONB NOT NULL DEFAULT '{}', result_object_key TEXT, last_error TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT knowledge_sync_jobs_dedupe_key UNIQUE(account_id, vdn_id, dedupe_key),
  CONSTRAINT knowledge_sync_jobs_payload_size CHECK (pg_column_size(payload) <= 262144)
);
CREATE INDEX knowledge_sync_jobs_due_idx ON knowledge_sync_jobs(state, next_run_at);
CREATE INDEX knowledge_sync_jobs_scope_idx ON knowledge_sync_jobs(account_id, vdn_id, document_id);

CREATE TABLE knowledge_audit_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  account_id INTEGER NOT NULL, vdn_id INTEGER NOT NULL, actor_kind TEXT NOT NULL,
  actor_id TEXT, action TEXT NOT NULL, resource_id TEXT NOT NULL,
  previous_revision INTEGER, next_revision INTEGER, request_id TEXT NOT NULL,
  outcome TEXT NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX knowledge_audit_events_resource_idx ON knowledge_audit_events(account_id, vdn_id, resource_id, created_at);
CREATE INDEX knowledge_audit_events_request_idx ON knowledge_audit_events(request_id);
