-- Un poste peut avoir plusieurs utilisateurs affectés : l'affectation unique devient une table de liaison.

-- CreateTable
CREATE TABLE "post_user" (
    "post_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "post_user_pkey" PRIMARY KEY ("post_id","user_id")
);

-- CreateIndex
CREATE INDEX "post_user_user_id_idx" ON "post_user"("user_id");

-- AddForeignKey
ALTER TABLE "post_user" ADD CONSTRAINT "post_user_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_user" ADD CONSTRAINT "post_user_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise des affectations existantes
INSERT INTO "post_user" ("post_id", "user_id") SELECT "id", "user_id" FROM "post" WHERE "user_id" IS NOT NULL;

-- Ancienne colonne
ALTER TABLE "post" DROP CONSTRAINT "post_user_id_fkey";
DROP INDEX "post_user_id_idx";
ALTER TABLE "post" DROP COLUMN "user_id";
