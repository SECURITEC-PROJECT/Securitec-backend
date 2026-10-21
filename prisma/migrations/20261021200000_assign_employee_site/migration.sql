ALTER TABLE "agent" ADD COLUMN "site_id" UUID;

CREATE INDEX "idx_agent_site" ON "agent"("site_id");

ALTER TABLE "agent"
ADD CONSTRAINT "fk_agent_site"
FOREIGN KEY ("site_id") REFERENCES "site"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
