ALTER TABLE "controle_alcoolemie"
ADD COLUMN "client_request_id" UUID;

CREATE UNIQUE INDEX "controle_alcoolemie_client_request_id_key"
ON "controle_alcoolemie"("client_request_id");