-- Existing role IDs: 1=administrator, 2=supervisor, 3=agent.
-- New role IDs: 1=administrator, 2=chef de poste, 3=responsable sécurité,
-- 4=direction/RAF/chefs de service, 5=agent APS.
-- Preserve existing administrator accounts, and map the former supervisor
-- and agent roles to the closest matching profiles in the requirements.
UPDATE utilisateur
SET role = CASE role WHEN 2 THEN 3 WHEN 3 THEN 5 ELSE role END
WHERE role IN (2, 3);
