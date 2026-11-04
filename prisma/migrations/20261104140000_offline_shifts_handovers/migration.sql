ALTER TABLE "service_poste"
  ADD COLUMN "client_request_id" UUID,
  ADD COLUMN "end_request_id" UUID;

CREATE UNIQUE INDEX "service_poste_client_request_id_key"
  ON "service_poste"("client_request_id");

CREATE UNIQUE INDEX "service_poste_end_request_id_key"
  ON "service_poste"("end_request_id");

ALTER TABLE "passation"
  ADD COLUMN "client_request_id" UUID;

CREATE UNIQUE INDEX "passation_client_request_id_key"
  ON "passation"("client_request_id");
