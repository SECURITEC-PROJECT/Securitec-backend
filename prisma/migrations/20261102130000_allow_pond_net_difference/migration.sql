-- NET is entered manually and may differ from BRUT - TARE.
ALTER TABLE "pond_brut"
  DROP CONSTRAINT IF EXISTS "pond_brut_pesage_check",
  ADD CONSTRAINT "pond_brut_pesage_check" CHECK (
    "brut" > 0 AND "tare" > 0 AND "net" > 0
  );
