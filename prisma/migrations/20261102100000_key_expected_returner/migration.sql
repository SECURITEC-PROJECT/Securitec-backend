ALTER TABLE "suivi_cle"
  ADD COLUMN "date_retour_prevue" DATE,
  ADD COLUMN "nom_retourneur" VARCHAR(100),
  ADD COLUMN "prenom_retourneur" VARCHAR(100),
  ADD COLUMN "matricule_retourneur" VARCHAR(50);
