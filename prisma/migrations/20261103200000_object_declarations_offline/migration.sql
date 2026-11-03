ALTER TABLE "declaration_objet"
ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "client_request_id" UUID,
ADD COLUMN IF NOT EXISTS "update_request_id" UUID,
ADD COLUMN IF NOT EXISTS "delete_request_id" UUID;

DROP INDEX IF EXISTS "uq_declaration_objet_site_numero";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_declaration_objet_site_numero"
ON "declaration_objet"("site_id", (lower("donnees"->>'referenceNumber')))
WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "declaration_objet_client_request_id_key"
ON "declaration_objet"("client_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "declaration_objet_update_request_id_key"
ON "declaration_objet"("update_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "declaration_objet_delete_request_id_key"
ON "declaration_objet"("delete_request_id");