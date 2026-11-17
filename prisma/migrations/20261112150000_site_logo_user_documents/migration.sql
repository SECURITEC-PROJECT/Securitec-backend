-- CreateTable
CREATE TABLE "site_logo" (
    "site_id" UUID NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "content" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "user_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_logo_pkey" PRIMARY KEY ("site_id")
);

-- CreateTable
CREATE TABLE "user_document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" VARCHAR(240) NOT NULL,
    "extension" VARCHAR(12) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "size" INTEGER NOT NULL,
    "category" VARCHAR(80) NOT NULL DEFAULT 'Autre',
    "content" BYTEA NOT NULL,
    "added_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_document_user_id_idx" ON "user_document"("user_id");

-- AddForeignKey
ALTER TABLE "site_logo" ADD CONSTRAINT "site_logo_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_document" ADD CONSTRAINT "user_document_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
