ALTER TABLE "passation"
  ADD COLUMN IF NOT EXISTS "inventaire" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "documents_retenus" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "confirmation_sortant_le" TIMESTAMP(6),
  ADD COLUMN IF NOT EXISTS "confirmation_entrant_le" TIMESTAMP(6);
