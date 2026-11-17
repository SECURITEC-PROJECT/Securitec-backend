-- Chaque utilisateur a son propre matricule (obligatoire, unique) ; il peut s'en servir pour se connecter.

-- Les comptes existants reçoivent un matricule provisoire (M0001, M0002… par ancienneté), à corriger depuis la fiche utilisateur.
ALTER TABLE "app_user" ADD COLUMN "matricule" VARCHAR(50);

UPDATE "app_user" u
SET "matricule" = 'M' || lpad(n.rn::text, 4, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn FROM "app_user") n
WHERE n."id" = u."id";

ALTER TABLE "app_user" ALTER COLUMN "matricule" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "app_user_matricule_key" ON "app_user"("matricule");
