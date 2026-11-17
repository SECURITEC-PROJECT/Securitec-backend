-- CreateEnum
CREATE TYPE "column_action" AS ENUM ('ATTACH_FILES');

-- AlterEnum
ALTER TYPE "column_type" ADD VALUE 'ACTION';

-- AlterTable
ALTER TABLE "sheet_column" ADD COLUMN "action" "column_action";

-- CreateTable
CREATE TABLE "sheet_file" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "row_id" UUID NOT NULL,
    "column_id" UUID NOT NULL,
    "name" VARCHAR(240) NOT NULL,
    "extension" VARCHAR(12) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "added_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sheet_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sheet_file_row_id_column_id_idx" ON "sheet_file"("row_id", "column_id");

-- AddForeignKey
ALTER TABLE "sheet_file" ADD CONSTRAINT "sheet_file_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "sheet_row"("id") ON DELETE CASCADE ON UPDATE CASCADE;
