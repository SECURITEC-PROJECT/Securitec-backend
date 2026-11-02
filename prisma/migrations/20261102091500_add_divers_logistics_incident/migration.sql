ALTER TABLE "signalement_logistique"
  DROP CONSTRAINT IF EXISTS "signalement_logistique_type_check";

ALTER TABLE "signalement_logistique"
  ADD CONSTRAINT "signalement_logistique_type_check"
  CHECK ("type_signalement" IN ('ANOMALIE', 'DIVERS', 'VIOLATION_PROCEDURE'));
