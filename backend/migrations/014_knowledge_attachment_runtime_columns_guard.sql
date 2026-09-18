-- Hotfix: guarantee the runtime columns required by document-only Knowledge guides.
-- This migration is intentionally idempotent and also repairs schema drift if a prior
-- deployment started without applying 012/013 completely.
ALTER TABLE "KnowledgeAttachments"
  ADD COLUMN IF NOT EXISTS "SizeBytes" BIGINT,
  ADD COLUMN IF NOT EXISTS "IsPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "ExtractionStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "ExtractionError" TEXT,
  ADD COLUMN IF NOT EXISTS "IndexedAt" TEXT,
  ADD COLUMN IF NOT EXISTS "SearchText" TEXT,
  ADD COLUMN IF NOT EXISTS "Status" TEXT NOT NULL DEFAULT 'UPLOADED',
  ADD COLUMN IF NOT EXISTS "ActualizadoPor" TEXT,
  ADD COLUMN IF NOT EXISTS "FechaActualizacion" TEXT;

UPDATE "KnowledgeAttachments"
   SET "SizeBytes" = CASE
         WHEN "SizeBytes" IS NOT NULL THEN "SizeBytes"
         WHEN COALESCE("Size",'') ~ '^[0-9]+$' THEN "Size"::bigint
         ELSE 0
       END,
       "ExtractionStatus" = COALESCE(NULLIF("ExtractionStatus",''),'UPLOADED'),
       "SearchText" = COALESCE("SearchText",''),
       "Status" = COALESCE(NULLIF("Status",''),'UPLOADED')
 WHERE "SizeBytes" IS NULL
    OR "ExtractionStatus" IS NULL OR "ExtractionStatus"=''
    OR "SearchText" IS NULL
    OR "Status" IS NULL OR "Status"='';

ALTER TABLE "KnowledgeAttachments"
  ALTER COLUMN "ExtractionStatus" SET DEFAULT 'UPLOADED',
  ALTER COLUMN "ExtractionStatus" SET NOT NULL,
  ALTER COLUMN "SearchText" SET DEFAULT '',
  ALTER COLUMN "SearchText" SET NOT NULL,
  ALTER COLUMN "Status" SET DEFAULT 'UPLOADED',
  ALTER COLUMN "Status" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_knowledge_attachments_primary_article
  ON "KnowledgeAttachments" ("TutorialID")
  WHERE "__valid"=TRUE AND "IsPrimary"=TRUE;

CREATE INDEX IF NOT EXISTS ix_knowledge_attachments_article_status
  ON "KnowledgeAttachments" ("TutorialID","ExtractionStatus","__valid");

CREATE INDEX IF NOT EXISTS ix_knowledge_attachments_mime
  ON "KnowledgeAttachments" ("MimeType","__valid");
