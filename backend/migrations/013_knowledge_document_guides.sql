-- Knowledge documental avanzado sobre 012_ai_integral_agent.sql.
-- Drive conserva los binarios; PostgreSQL agrega metadata de biblioteca y estado visual.
ALTER TABLE "KnowledgeAttachments"
  ADD COLUMN IF NOT EXISTS "SizeBytes" BIGINT,
  ADD COLUMN IF NOT EXISTS "IsPrimary" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "Status" TEXT NOT NULL DEFAULT 'UPLOADED';

ALTER TABLE "KnowledgeAttachments"
  ALTER COLUMN "ExtractionStatus" SET DEFAULT 'UPLOADED',
  ALTER COLUMN "SearchText" SET DEFAULT '';

UPDATE "KnowledgeAttachments"
   SET "SizeBytes" = CASE
         WHEN COALESCE("Size",'') ~ '^[0-9]+$' THEN "Size"::bigint
         ELSE COALESCE("SizeBytes",0)
       END,
       "ExtractionStatus" = COALESCE(NULLIF("ExtractionStatus",''),'UPLOADED'),
       "SearchText" = COALESCE("SearchText",''),
       "Status" = COALESCE(NULLIF("Status",''),'UPLOADED')
 WHERE "SizeBytes" IS NULL
    OR "ExtractionStatus" IS NULL OR "ExtractionStatus"=''
    OR "SearchText" IS NULL
    OR "Status" IS NULL OR "Status"='';

ALTER TABLE "KnowledgeAttachments"
  ALTER COLUMN "ExtractionStatus" SET NOT NULL,
  ALTER COLUMN "SearchText" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_knowledge_attachments_primary_article
  ON "KnowledgeAttachments" ("TutorialID")
  WHERE "__valid"=TRUE AND "IsPrimary"=TRUE;

CREATE INDEX IF NOT EXISTS ix_knowledge_attachments_article_status
  ON "KnowledgeAttachments" ("TutorialID","ExtractionStatus","__valid");

CREATE INDEX IF NOT EXISTS ix_knowledge_attachments_mime
  ON "KnowledgeAttachments" ("MimeType","__valid");
