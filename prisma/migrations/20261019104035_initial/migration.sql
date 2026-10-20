-- CreateEnum
CREATE TYPE "type_site" AS ENUM ('USINE', 'AGENCE');

-- CreateEnum
CREATE TYPE "shift_agent" AS ENUM ('JOUR', 'NUIT');

-- CreateTable
CREATE TABLE "site" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nom" VARCHAR(255) NOT NULL,
    "adresse" TEXT NOT NULL,
    "horaires_ouverture" VARCHAR(255),
    "type_site" "type_site" NOT NULL DEFAULT 'USINE',

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utilisateur" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nom" VARCHAR(255) NOT NULL,
    "identifiant" VARCHAR(100) NOT NULL,
    "role" INTEGER NOT NULL,
    "pin_hache" VARCHAR(255) NOT NULL,
    "site_id" UUID,

    CONSTRAINT "utilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consigne" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message" TEXT NOT NULL,
    "cible" VARCHAR(255) NOT NULL,
    "urgence" INTEGER NOT NULL,
    "validite" TIMESTAMP(6) NOT NULL,
    "utilisateur_id" UUID NOT NULL,

    CONSTRAINT "consigne_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uid_nfc" VARCHAR(255) NOT NULL,
    "couleur" VARCHAR(50),
    "statut" INTEGER NOT NULL,
    "validite" TIMESTAMP(6) NOT NULL,
    "utilisateur_id" UUID,

    CONSTRAINT "badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visiteur" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "identite" VARCHAR(255) NOT NULL,
    "societe" VARCHAR(255),
    "liste_noire" BOOLEAN NOT NULL DEFAULT false,
    "site_id" UUID,
    "badge_id" UUID,

    CONSTRAINT "visiteur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entree" TIMESTAMP(6) NOT NULL,
    "sortie" TIMESTAMP(6),
    "motif" TEXT,
    "badge_id" UUID NOT NULL,
    "visiteur_id" UUID,

    CONSTRAINT "passage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ouverture" TIMESTAMP(6) NOT NULL,
    "cloture" TIMESTAMP(6),
    "passation" TEXT,
    "utilisateur_id" UUID NOT NULL,

    CONSTRAINT "vacation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compte_rendu" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "observations" TEXT,
    "signature" VARCHAR(255),
    "pdf" TEXT,
    "statut_validation" VARCHAR(100) NOT NULL,
    "vacation_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "prestataire_id" UUID NOT NULL,
    "poste_id" UUID NOT NULL,
    "date_rapport" DATE NOT NULL,
    "debut_service" TIME(0) NOT NULL,
    "fin_service" TIME(0) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "compte_rendu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evenement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" VARCHAR(100) NOT NULL,
    "gravite" INTEGER NOT NULL,
    "description" TEXT,
    "lien_origine" VARCHAR(255),
    "vacation_id" UUID NOT NULL,
    "compte_rendu_id" UUID,

    CONSTRAINT "evenement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nom" VARCHAR(255) NOT NULL,
    "niveau_acces_requis" INTEGER NOT NULL,
    "site_id" UUID NOT NULL,

    CONSTRAINT "zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lecteur" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "uid_nfc" VARCHAR(255) NOT NULL,
    "emplacement" VARCHAR(255) NOT NULL,
    "zone_id" UUID NOT NULL,

    CONSTRAINT "lecteur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lecture_badge" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "horodatage" TIMESTAMP(6) NOT NULL,
    "decision" VARCHAR(100) NOT NULL,
    "autoriser" BOOLEAN NOT NULL,
    "badge_id" UUID NOT NULL,
    "lecteur_id" UUID NOT NULL,

    CONSTRAINT "lecture_badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "camera" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nom" VARCHAR(255) NOT NULL,
    "url_flux" TEXT NOT NULL,
    "etat" VARCHAR(100) NOT NULL,
    "zone_id" UUID NOT NULL,

    CONSTRAINT "camera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "immatriculation" VARCHAR(50) NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "liste_noire" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "vehicule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passage_vehicule" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entree" TIMESTAMP(6) NOT NULL,
    "sortie" TIMESTAMP(6),
    "photos" TEXT,
    "vehicule_id" UUID NOT NULL,
    "vacation_id" UUID,

    CONSTRAINT "passage_vehicule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prestataire" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nom" VARCHAR(160) NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "prestataire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poste" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nom" VARCHAR(160) NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "site_id" UUID NOT NULL,

    CONSTRAINT "poste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prenom" VARCHAR(100) NOT NULL,
    "nom" VARCHAR(100) NOT NULL,
    "matricule" VARCHAR(50) NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "prestataire_id" UUID NOT NULL,

    CONSTRAINT "agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compte_rendu_agent" (
    "compte_rendu_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "poste_id" UUID NOT NULL,
    "shift" "shift_agent" NOT NULL,

    CONSTRAINT "compte_rendu_agent_pkey" PRIMARY KEY ("compte_rendu_id","agent_id","shift")
);

-- CreateTable
CREATE TABLE "audit_compte_rendu" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "compte_rendu_id" UUID NOT NULL,
    "utilisateur_id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "avant" JSONB,
    "apres" JSONB NOT NULL,
    "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_compte_rendu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "utilisateur_identifiant_key" ON "utilisateur"("identifiant");

-- CreateIndex
CREATE INDEX "idx_utilisateur_site" ON "utilisateur"("site_id");

-- CreateIndex
CREATE INDEX "idx_consigne_utilisateur" ON "consigne"("utilisateur_id");

-- CreateIndex
CREATE UNIQUE INDEX "badge_uid_nfc_key" ON "badge"("uid_nfc");

-- CreateIndex
CREATE INDEX "idx_badge_utilisateur" ON "badge"("utilisateur_id");

-- CreateIndex
CREATE UNIQUE INDEX "visiteur_badge_id_key" ON "visiteur"("badge_id");

-- CreateIndex
CREATE INDEX "idx_visiteur_site" ON "visiteur"("site_id");

-- CreateIndex
CREATE INDEX "idx_passage_badge" ON "passage"("badge_id");

-- CreateIndex
CREATE INDEX "idx_vacation_utilisateur" ON "vacation"("utilisateur_id");

-- CreateIndex
CREATE UNIQUE INDEX "compte_rendu_vacation_id_key" ON "compte_rendu"("vacation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_compte_rendu_site_date" ON "compte_rendu"("site_id", "date_rapport");

-- CreateIndex
CREATE INDEX "idx_evenement_vacation" ON "evenement"("vacation_id");

-- CreateIndex
CREATE INDEX "idx_zone_site" ON "zone"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "lecteur_uid_nfc_key" ON "lecteur"("uid_nfc");

-- CreateIndex
CREATE INDEX "idx_lecteur_zone" ON "lecteur"("zone_id");

-- CreateIndex
CREATE INDEX "idx_lecture_badge_badge" ON "lecture_badge"("badge_id");

-- CreateIndex
CREATE INDEX "idx_lecture_badge_lecteur" ON "lecture_badge"("lecteur_id");

-- CreateIndex
CREATE INDEX "idx_camera_zone" ON "camera"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicule_immatriculation_key" ON "vehicule"("immatriculation");

-- CreateIndex
CREATE INDEX "idx_passage_vehicule_vehicule" ON "passage_vehicule"("vehicule_id");

-- CreateIndex
CREATE UNIQUE INDEX "prestataire_nom_key" ON "prestataire"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "uq_poste_site_nom" ON "poste"("site_id", "nom");

-- CreateIndex
CREATE UNIQUE INDEX "agent_matricule_key" ON "agent"("matricule");

-- CreateIndex
CREATE INDEX "idx_audit_cr_date" ON "audit_compte_rendu"("compte_rendu_id", "cree_le");

-- AddForeignKey
ALTER TABLE "utilisateur" ADD CONSTRAINT "fk_utilisateur_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consigne" ADD CONSTRAINT "fk_consigne_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge" ADD CONSTRAINT "fk_badge_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visiteur" ADD CONSTRAINT "fk_visiteur_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visiteur" ADD CONSTRAINT "fk_visiteur_badge" FOREIGN KEY ("badge_id") REFERENCES "badge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passage" ADD CONSTRAINT "fk_passage_badge" FOREIGN KEY ("badge_id") REFERENCES "badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passage" ADD CONSTRAINT "fk_passage_visiteur" FOREIGN KEY ("visiteur_id") REFERENCES "visiteur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacation" ADD CONSTRAINT "fk_vacation_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compte_rendu" ADD CONSTRAINT "fk_compterendu_vacation" FOREIGN KEY ("vacation_id") REFERENCES "vacation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compte_rendu" ADD CONSTRAINT "fk_compterendu_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compte_rendu" ADD CONSTRAINT "fk_compterendu_prestataire" FOREIGN KEY ("prestataire_id") REFERENCES "prestataire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compte_rendu" ADD CONSTRAINT "fk_compterendu_poste" FOREIGN KEY ("poste_id") REFERENCES "poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evenement" ADD CONSTRAINT "fk_evenement_vacation" FOREIGN KEY ("vacation_id") REFERENCES "vacation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evenement" ADD CONSTRAINT "fk_evenement_compte_rendu" FOREIGN KEY ("compte_rendu_id") REFERENCES "compte_rendu"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone" ADD CONSTRAINT "fk_zone_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lecteur" ADD CONSTRAINT "fk_lecteur_zone" FOREIGN KEY ("zone_id") REFERENCES "zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lecture_badge" ADD CONSTRAINT "fk_lecture_badge" FOREIGN KEY ("badge_id") REFERENCES "badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lecture_badge" ADD CONSTRAINT "fk_lecture_lecteur" FOREIGN KEY ("lecteur_id") REFERENCES "lecteur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "camera" ADD CONSTRAINT "fk_camera_zone" FOREIGN KEY ("zone_id") REFERENCES "zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passage_vehicule" ADD CONSTRAINT "fk_passagevehicule_vehicule" FOREIGN KEY ("vehicule_id") REFERENCES "vehicule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passage_vehicule" ADD CONSTRAINT "fk_passagevehicule_vacation" FOREIGN KEY ("vacation_id") REFERENCES "vacation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poste" ADD CONSTRAINT "fk_poste_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent" ADD CONSTRAINT "fk_agent_prestataire" FOREIGN KEY ("prestataire_id") REFERENCES "prestataire"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compte_rendu_agent" ADD CONSTRAINT "fk_cr_agent_compte_rendu" FOREIGN KEY ("compte_rendu_id") REFERENCES "compte_rendu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compte_rendu_agent" ADD CONSTRAINT "fk_cr_agent_agent" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compte_rendu_agent" ADD CONSTRAINT "fk_cr_agent_poste" FOREIGN KEY ("poste_id") REFERENCES "poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_compte_rendu" ADD CONSTRAINT "fk_audit_cr" FOREIGN KEY ("compte_rendu_id") REFERENCES "compte_rendu"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_compte_rendu" ADD CONSTRAINT "fk_audit_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
