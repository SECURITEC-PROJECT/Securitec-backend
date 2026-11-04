ALTER TABLE "ronde"
  ADD COLUMN "client_request_id" UUID;

CREATE UNIQUE INDEX "ronde_client_request_id_key"
  ON "ronde"("client_request_id");
