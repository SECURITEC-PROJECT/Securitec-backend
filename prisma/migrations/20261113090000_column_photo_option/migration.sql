-- AlterTable
ALTER TABLE "sheet_column" ADD COLUMN "allow_upload" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "allow_photo" BOOLEAN NOT NULL DEFAULT false;
