-- AlterTable : un signalement peut être marqué « traité »
ALTER TABLE "sheet_report" ADD COLUMN "resolved_at" TIMESTAMPTZ(6),
ADD COLUMN "resolved_by" UUID;

-- AddForeignKey
ALTER TABLE "sheet_report" ADD CONSTRAINT "sheet_report_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
