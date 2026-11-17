-- CreateTable
CREATE TABLE "user_photo" (
    "user_id" UUID NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "content" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_photo_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_photo" ADD CONSTRAINT "user_photo_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
