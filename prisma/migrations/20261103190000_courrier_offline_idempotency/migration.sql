ALTER TABLE "mouvement_courrier"
ADD COLUMN IF NOT EXISTS "modifie_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "client_request_id" UUID,
ADD COLUMN IF NOT EXISTS "update_request_id" UUID,
ADD COLUMN IF NOT EXISTS "exit_request_id" UUID,
ADD COLUMN IF NOT EXISTS "delete_request_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "mouvement_courrier_client_request_id_key"
ON "mouvement_courrier"("client_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mouvement_courrier_update_request_id_key"
ON "mouvement_courrier"("update_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mouvement_courrier_exit_request_id_key"
ON "mouvement_courrier"("exit_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mouvement_courrier_delete_request_id_key"
ON "mouvement_courrier"("delete_request_id");