-- AlterTable : droits propres à chaque feuille. Les feuilles existantes gardent tous leurs droits ; les nouvelles n'ont pas la suppression par défaut.
ALTER TABLE "post_sheet" ADD COLUMN "allow_create" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "allow_update" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "allow_delete" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "post_sheet" ALTER COLUMN "allow_delete" SET DEFAULT false;
