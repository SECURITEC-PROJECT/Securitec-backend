-- Comptes rendus d'un site : mise en page libre (blocs de texte et tableaux liés aux feuilles de saisie).

-- CreateTable
CREATE TABLE "minutes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "site_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "layout" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "minutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "minutes_site_id_idx" ON "minutes"("site_id");

-- AddForeignKey
ALTER TABLE "minutes" ADD CONSTRAINT "minutes_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
