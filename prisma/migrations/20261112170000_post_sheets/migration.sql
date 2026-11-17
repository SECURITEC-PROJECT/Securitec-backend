-- CreateEnum
CREATE TYPE "column_type" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'TIME', 'SELECT', 'CHECKBOX');

-- CreateTable
CREATE TABLE "post_sheet" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "post_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "post_sheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_column" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sheet_id" UUID NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "type" "column_type" NOT NULL DEFAULT 'TEXT',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sheet_column_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet_row" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sheet_id" UUID NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sheet_row_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_sheet_post_id_name_key" ON "post_sheet"("post_id", "name");

-- CreateIndex
CREATE INDEX "sheet_column_sheet_id_idx" ON "sheet_column"("sheet_id");

-- CreateIndex
CREATE INDEX "sheet_row_sheet_id_created_at_idx" ON "sheet_row"("sheet_id", "created_at");

-- AddForeignKey
ALTER TABLE "post_sheet" ADD CONSTRAINT "post_sheet_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_column" ADD CONSTRAINT "sheet_column_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "post_sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_row" ADD CONSTRAINT "sheet_row_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "post_sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_row" ADD CONSTRAINT "sheet_row_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
