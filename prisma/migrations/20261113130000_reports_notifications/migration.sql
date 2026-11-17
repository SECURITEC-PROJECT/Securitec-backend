-- CreateTable
CREATE TABLE "sheet_report" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sheet_id" UUID NOT NULL,
    "row_id" UUID,
    "post_id" UUID NOT NULL,
    "site_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "from_profile" INTEGER NOT NULL,
    "to_profile" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "parent_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sheet_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL DEFAULT 'REPORT',
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "report_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sheet_report_sheet_id_idx" ON "sheet_report"("sheet_id");

-- CreateIndex
CREATE INDEX "sheet_report_parent_id_idx" ON "sheet_report"("parent_id");

-- CreateIndex
CREATE INDEX "notification_user_id_read_at_created_at_idx" ON "notification"("user_id", "read_at", "created_at");

-- AddForeignKey
ALTER TABLE "sheet_report" ADD CONSTRAINT "sheet_report_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "post_sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_report" ADD CONSTRAINT "sheet_report_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "sheet_row"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_report" ADD CONSTRAINT "sheet_report_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_report" ADD CONSTRAINT "sheet_report_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "sheet_report"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "sheet_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
