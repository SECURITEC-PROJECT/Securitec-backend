-- CreateTable
CREATE TABLE "prise_de_poste" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "matricule" VARCHAR(50) NOT NULL,
    "nom" VARCHAR(100) NOT NULL,
    "prenom" VARCHAR(100) NOT NULL,
    "prestataire" VARCHAR(160) NOT NULL,
    "site_de_travail" VARCHAR(255) NOT NULL,
    "notes" TEXT,
    "started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(6),

    CONSTRAINT "prise_de_poste_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_prise_de_poste_started" ON "prise_de_poste"("started_at");