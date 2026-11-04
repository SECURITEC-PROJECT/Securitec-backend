ALTER TABLE "camera"
  ADD COLUMN "client_request_id" UUID;

CREATE UNIQUE INDEX "camera_client_request_id_key"
  ON "camera"("client_request_id");

ALTER TABLE "mouvement_aps_evenement"
  ADD COLUMN "client_request_id" UUID;

CREATE UNIQUE INDEX "mouvement_aps_evenement_client_request_id_key"
  ON "mouvement_aps_evenement"("client_request_id");

ALTER TABLE "mouvement_aps_passation"
  ADD COLUMN "client_request_id" UUID;

CREATE UNIQUE INDEX "mouvement_aps_passation_client_request_id_key"
  ON "mouvement_aps_passation"("client_request_id");
