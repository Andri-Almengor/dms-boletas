-- Integral Gemini agent: document retrieval, secure chat uploads and controlled pending operations.
-- Do not edit prior migrations; this migration is intentionally additive.

ALTER TABLE "KnowledgeAttachments"
  ADD COLUMN IF NOT EXISTS "ExtractionStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "IndexedAt" TEXT,
  ADD COLUMN IF NOT EXISTS "ExtractionError" TEXT,
  ADD COLUMN IF NOT EXISTS "SearchText" TEXT,
  ADD COLUMN IF NOT EXISTS "FechaActualizacion" TEXT,
  ADD COLUMN IF NOT EXISTS "ActualizadoPor" TEXT;

CREATE TABLE IF NOT EXISTS "KnowledgeDocumentChunks" (
  "ChunkID" TEXT NOT NULL,
  "DocumentID" TEXT NOT NULL,
  "ArticleID" TEXT NOT NULL,
  "ChunkIndex" INTEGER NOT NULL,
  "PageNumber" INTEGER,
  "SectionTitle" TEXT,
  "Content" TEXT NOT NULL,
  "SearchText" TEXT NOT NULL DEFAULT '',
  "CreatedAt" TEXT NOT NULL,
  "__valid" BOOLEAN NOT NULL DEFAULT TRUE,
  "__db_id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_knowledge_document_chunks_chunk
  ON "KnowledgeDocumentChunks" ("ChunkID")
  WHERE "__valid"=TRUE;

CREATE INDEX IF NOT EXISTS ix_knowledge_document_chunks_document
  ON "KnowledgeDocumentChunks" ("DocumentID", "ChunkIndex")
  WHERE "__valid"=TRUE;

CREATE INDEX IF NOT EXISTS ix_knowledge_document_chunks_article
  ON "KnowledgeDocumentChunks" ("ArticleID", "ChunkIndex")
  WHERE "__valid"=TRUE;

CREATE INDEX IF NOT EXISTS ix_knowledge_document_chunks_fts
  ON "KnowledgeDocumentChunks"
  USING GIN (to_tsvector('simple', COALESCE("SearchText",'') || ' ' || COALESCE("Content",'')))
  WHERE "__valid"=TRUE;

CREATE TABLE IF NOT EXISTS "AiPendingOperations" (
  "OperationID" TEXT NOT NULL,
  "UserID" TEXT NOT NULL,
  "SessionHash" TEXT NOT NULL,
  "Action" TEXT NOT NULL,
  "ArgumentsJSON" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "FilesJSON" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "PreviewJSON" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "Status" TEXT NOT NULL,
  "ResultJSON" JSONB,
  "ErrorJSON" JSONB,
  "IdempotencyKey" TEXT NOT NULL,
  "ExpiresAt" TEXT NOT NULL,
  "CreatedAt" TEXT NOT NULL,
  "UpdatedAt" TEXT NOT NULL,
  "CommittedAt" TEXT,
  "__valid" BOOLEAN NOT NULL DEFAULT TRUE,
  "__db_id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_pending_operations_id
  ON "AiPendingOperations" ("OperationID")
  WHERE "__valid"=TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_pending_operations_idempotency
  ON "AiPendingOperations" ("IdempotencyKey")
  WHERE "__valid"=TRUE;

CREATE INDEX IF NOT EXISTS ix_ai_pending_operations_actor_status
  ON "AiPendingOperations" ("UserID", "Status", "ExpiresAt")
  WHERE "__valid"=TRUE;

CREATE TABLE IF NOT EXISTS "AiChatUploads" (
  "UploadID" TEXT NOT NULL,
  "UserID" TEXT NOT NULL,
  "SessionHash" TEXT NOT NULL,
  "NombreArchivo" TEXT NOT NULL,
  "MimeType" TEXT NOT NULL,
  "SizeBytes" BIGINT NOT NULL,
  "DriveFileID" TEXT NOT NULL,
  "DriveURL" TEXT,
  "Status" TEXT NOT NULL,
  "CreatedAt" TEXT NOT NULL,
  "ExpiresAt" TEXT NOT NULL,
  "ConsumedAt" TEXT,
  "OperationID" TEXT,
  "__valid" BOOLEAN NOT NULL DEFAULT TRUE,
  "__db_id" BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_chat_uploads_id
  ON "AiChatUploads" ("UploadID")
  WHERE "__valid"=TRUE;

CREATE INDEX IF NOT EXISTS ix_ai_chat_uploads_actor_status
  ON "AiChatUploads" ("UserID", "Status", "ExpiresAt")
  WHERE "__valid"=TRUE;
