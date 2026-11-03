ALTER TABLE "suivi_cle"
ADD COLUMN "client_request_id" UUID;

CREATE UNIQUE INDEX "suivi_cle_client_request_id_key"
ON "suivi_cle"("client_request_id");