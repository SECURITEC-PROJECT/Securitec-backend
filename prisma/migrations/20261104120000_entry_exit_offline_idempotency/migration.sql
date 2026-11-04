ALTER TABLE "passage"
  ADD COLUMN IF NOT EXISTS "client_request_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "passage_client_request_id_key"
  ON "passage"("client_request_id");

ALTER TABLE "passage"
  ADD COLUMN IF NOT EXISTS "exit_client_request_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "passage_exit_client_request_id_key"
  ON "passage"("exit_client_request_id");

ALTER TABLE "passage_vehicule"
  ADD COLUMN IF NOT EXISTS "client_request_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "passage_vehicule_client_request_id_key"
  ON "passage_vehicule"("client_request_id");

ALTER TABLE "passage_vehicule"
  ADD COLUMN IF NOT EXISTS "exit_client_request_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "passage_vehicule_exit_client_request_id_key"
  ON "passage_vehicule"("exit_client_request_id");
