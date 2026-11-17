-- AlterTable
ALTER TABLE "post" ADD COLUMN "user_id" UUID;

-- CreateIndex
CREATE INDEX "post_user_id_idx" ON "post"("user_id");

-- AddForeignKey
ALTER TABLE "post" ADD CONSTRAINT "post_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
