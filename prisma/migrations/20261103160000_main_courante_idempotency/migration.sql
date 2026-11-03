ALTER TABLE "main_courante"
ADD COLUMN IF NOT EXISTS "client_request_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "main_courante_client_request_id_key"
ON "main_courante"("client_request_id");