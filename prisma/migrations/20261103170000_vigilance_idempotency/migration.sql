ALTER TABLE "point_vigilance"
ADD COLUMN IF NOT EXISTS "client_request_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "point_vigilance_client_request_id_key"
ON "point_vigilance"("client_request_id");