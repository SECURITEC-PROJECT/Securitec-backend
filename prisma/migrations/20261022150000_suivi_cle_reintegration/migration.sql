-- Ajoute à "suivi_cle" le rôle, l'observation et le lien vers la perception d'origine.
-- perception_id : sur une ligne "Réintégration", id de la ligne "Perception" qu'elle clôture.

-- AlterTable
ALTER TABLE "suivi_cle" ADD COLUMN "role_personne" VARCHAR(100);
ALTER TABLE "suivi_cle" ADD COLUMN "observation" TEXT;
ALTER TABLE "suivi_cle" ADD COLUMN "perception_id" INTEGER;

-- CreateIndex
CREATE INDEX "idx_suivi_cle_perception" ON "suivi_cle"("perception_id");
