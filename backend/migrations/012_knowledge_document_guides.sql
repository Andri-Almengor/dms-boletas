-- Knowledge documental: metadata, documento principal, extracción y chunks indexados.
ALTER TABLE "KnowledgeAttachments"
  ADD COLUMN IF NOT EXISTS "SizeBytes" BIGINT,
  ADD COLUMN IF NOT EXISTS "IsPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "ExtractionStatus" TEXT NOT NULL DEFAULT 'UPLOADED',
  ADD COLUMN IF NOT EXISTS "ExtractionError" TEXT,
  ADD COLUMN IF NOT EXISTS "IndexedAt" TEXT,
  ADD COLUMN IF NOT EXISTS "SearchText" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "Status" TEXT NOT NULL DEFAULT 'UPLOADED',
  ADD COLUMN IF NOT EXISTS "ActualizadoPor" TEXT,
  ADD COLUMN IF NOT EXISTS "FechaActualizacion" TEXT;

UPDATE "KnowledgeAttachments"
   SET "SizeBytes" = CASE
     WHEN COALESCE("Size",'') ~ '^[0-9]+$' THEN "Size"::bigint
     ELSE COALESCE("SizeBytes",0)
   END
 WHERE "SizeBytes" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_knowledge_attachments_primary_article
  ON "KnowledgeAttachments" ("TutorialID")
  WHERE "__valid"=TRUE AND "IsPrimary"=TRUE;

CREATE INDEX IF NOT EXISTS ix_knowledge_attachments_article_status
  ON "KnowledgeAttachments" ("TutorialID","ExtractionStatus","__valid");

CREATE INDEX IF NOT EXISTS ix_knowledge_attachments_mime
  ON "KnowledgeAttachments" ("MimeType","__valid");

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

CREATE UNIQUE INDEX IF NOT EXISTS ux_knowledge_document_chunks_id
  ON "KnowledgeDocumentChunks" ("ChunkID")
  WHERE "__valid"=TRUE;

CREATE INDEX IF NOT EXISTS ix_knowledge_document_chunks_document
  ON "KnowledgeDocumentChunks" ("DocumentID","ChunkIndex","__valid");

CREATE INDEX IF NOT EXISTS ix_knowledge_document_chunks_article
  ON "KnowledgeDocumentChunks" ("ArticleID","ChunkIndex","__valid");

CREATE INDEX IF NOT EXISTS ix_knowledge_document_chunks_search
  ON "KnowledgeDocumentChunks"
  USING GIN (to_tsvector('simple',COALESCE("SearchText",'') || ' ' || COALESCE("Content",'')))
  WHERE "__valid"=TRUE;
