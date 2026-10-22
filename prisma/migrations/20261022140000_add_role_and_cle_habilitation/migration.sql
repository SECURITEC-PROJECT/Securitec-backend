-- Ajoute le rôle aux employés et crée la table des habilitations de clés.

-- AlterTable
ALTER TABLE "employe" ADD COLUMN "role" VARCHAR(100) NOT NULL DEFAULT 'Agent';

-- CreateTable
CREATE TABLE "cle_habilitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trousse_cle" VARCHAR(100) NOT NULL,
    "role_autorise" VARCHAR(100) NOT NULL,

    CONSTRAINT "cle_habilitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_cle_habilitation" ON "cle_habilitation"("trousse_cle", "role_autorise");
