-- CreateTable
CREATE TABLE "access_role" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "base_profile" INTEGER NOT NULL DEFAULT 5,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "access_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_id" UUID NOT NULL,
    "permission" VARCHAR(100) NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission")
);

-- CreateTable
CREATE TABLE "user_permission" (
    "user_id" UUID NOT NULL,
    "permission" VARCHAR(100) NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_permission_pkey" PRIMARY KEY ("user_id","permission")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_role_code_key" ON "access_role"("code");

-- AlterTable (la table app_user est vide à ce stade : les colonnes obligatoires s'ajoutent sans valeur par défaut)
ALTER TABLE "app_user" ALTER COLUMN "site_id" DROP NOT NULL,
ADD COLUMN "pin_hash" VARCHAR(255) NOT NULL,
ADD COLUMN "profile" INTEGER NOT NULL,
ADD COLUMN "role_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "app_user_role_id_idx" ON "app_user"("role_id");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "access_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "access_role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission" ADD CONSTRAINT "user_permission_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
