ALTER TABLE "suivi_cle"
ADD COLUMN "return_request_id" UUID,
ADD COLUMN "not_returned_request_id" UUID;

CREATE UNIQUE INDEX "suivi_cle_return_request_id_key"
ON "suivi_cle"("return_request_id");

CREATE UNIQUE INDEX "suivi_cle_not_returned_request_id_key"
ON "suivi_cle"("not_returned_request_id");