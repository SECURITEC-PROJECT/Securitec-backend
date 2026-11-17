-- Planning de l'agence : vacations des utilisateurs par site et par poste.

-- CreateTable
CREATE TABLE "shift" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "post_id" UUID,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shift_starts_at_ends_at_idx" ON "shift"("starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "shift_user_id_starts_at_idx" ON "shift"("user_id", "starts_at");

-- CreateIndex
CREATE INDEX "shift_site_id_idx" ON "shift"("site_id");

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
