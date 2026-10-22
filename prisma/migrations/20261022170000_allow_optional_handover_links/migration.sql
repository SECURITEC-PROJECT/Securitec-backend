-- Une passation peut être créée depuis une prise_de_poste sans vacation Prisma
-- liée. Ces relations sont facultatives dans le schéma applicatif.
ALTER TABLE "passation"
  ALTER COLUMN "site_id" DROP NOT NULL,
  ALTER COLUMN "vacation_id" DROP NOT NULL;
