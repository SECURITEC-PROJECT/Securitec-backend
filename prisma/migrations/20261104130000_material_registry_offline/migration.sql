ALTER TABLE "materiel_sous_traitant"
  ADD COLUMN IF NOT EXISTS "client_request_id" UUID,
  ADD COLUMN IF NOT EXISTS "update_request_id" UUID,
  ADD COLUMN IF NOT EXISTS "exit_request_id" UUID,
  ADD COLUMN IF NOT EXISTS "cancel_request_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "materiel_sous_traitant_client_request_id_key"
  ON "materiel_sous_traitant"("client_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "materiel_sous_traitant_update_request_id_key"
  ON "materiel_sous_traitant"("update_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "materiel_sous_traitant_exit_request_id_key"
  ON "materiel_sous_traitant"("exit_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "materiel_sous_traitant_cancel_request_id_key"
  ON "materiel_sous_traitant"("cancel_request_id");

ALTER TABLE "materiel_star"
  ADD COLUMN IF NOT EXISTS "client_request_id" UUID,
  ADD COLUMN IF NOT EXISTS "update_request_id" UUID,
  ADD COLUMN IF NOT EXISTS "exit_request_id" UUID,
  ADD COLUMN IF NOT EXISTS "cancel_request_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "materiel_star_client_request_id_key"
  ON "materiel_star"("client_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "materiel_star_update_request_id_key"
  ON "materiel_star"("update_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "materiel_star_exit_request_id_key"
  ON "materiel_star"("exit_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "materiel_star_cancel_request_id_key"
  ON "materiel_star"("cancel_request_id");
