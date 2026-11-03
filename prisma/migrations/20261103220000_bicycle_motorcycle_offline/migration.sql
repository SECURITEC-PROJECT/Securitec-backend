ALTER TABLE "mouvement_velo"
ADD COLUMN IF NOT EXISTS "modifie_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "client_request_id" UUID,
ADD COLUMN IF NOT EXISTS "update_request_id" UUID,
ADD COLUMN IF NOT EXISTS "exit_request_id" UUID,
ADD COLUMN IF NOT EXISTS "delete_request_id" UUID;

ALTER TABLE "mouvement_moto"
ADD COLUMN IF NOT EXISTS "modifie_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "client_request_id" UUID,
ADD COLUMN IF NOT EXISTS "update_request_id" UUID,
ADD COLUMN IF NOT EXISTS "exit_request_id" UUID,
ADD COLUMN IF NOT EXISTS "delete_request_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "mouvement_velo_client_request_id_key" ON "mouvement_velo"("client_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mouvement_velo_update_request_id_key" ON "mouvement_velo"("update_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mouvement_velo_exit_request_id_key" ON "mouvement_velo"("exit_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mouvement_velo_delete_request_id_key" ON "mouvement_velo"("delete_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mouvement_moto_client_request_id_key" ON "mouvement_moto"("client_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mouvement_moto_update_request_id_key" ON "mouvement_moto"("update_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mouvement_moto_exit_request_id_key" ON "mouvement_moto"("exit_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "mouvement_moto_delete_request_id_key" ON "mouvement_moto"("delete_request_id");