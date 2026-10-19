# PostgreSQL et Prisma

Le schéma Prisma reprend les 15 tables du SQL fourni (`site`, `utilisateur`, `consigne`, `badge`, `visiteur`, `passage`, `vacation`, `compte_rendu`, `evenement`, `zone`, `lecteur`, `lecture_badge`, `camera`, `vehicule`, `passage_vehicule`) et ajoute les référentiels prestataire, poste et agent pour le rapport journalier usine/agence.

Le CR garde les rubriques variables des modèles Excel dans `compte_rendu.details` (JSONB). Il est aussi lié à une vacation, un site, un prestataire et un poste. La règle d’un CR par site et par journée est matérialisée par l’index unique `(site_id, date_rapport)`.

## Configurer PostgreSQL

1. Dans Neon, créer un projet PostgreSQL, puis ouvrir **Connect** et sélectionner la branche et la base voulues.
2. Copier l’URL **Pooled connection** dans `DATABASE_URL` pour les connexions de l’application. Copier l’URL **Direct connection** dans `DIRECT_URL` pour les migrations Prisma. Neon distingue les URL poolées par le suffixe `-pooler` dans l’hôte ; la chaîne complète inclut `sslmode=require`.
3. Copier `.env.example` vers `.env`, remplacer les exemples par les URL copiées et définir `SHADOW_DATABASE_URL` vers une base ou une branche Neon séparée réservée à Prisma Migrate. Ne jamais réutiliser l’URL de production comme base shadow : Prisma s’en sert pour ses vérifications de migration.
4. Depuis `Securitec-backend`, installer les dépendances puis créer/appliquer la migration initiale :

```powershell
npm.cmd install
npm.cmd run db:migrate -- --name initial
npm.cmd run prisma:generate
```

La commande `migrate dev` génère le fichier SQL versionné dans `prisma/migrations` et l’applique à la base de développement. En production, déployer les migrations déjà générées avec `npm.cmd run db:deploy`.

Les UUID utilisent la fonction PostgreSQL `gen_random_uuid()`. L’extension `uuid-ossp` du SQL fourni n’est donc pas nécessaire sur PostgreSQL récent. `identifiant` a été ajouté à `utilisateur` pour permettre une authentification par login. `type_site` distingue les modèles usine et agence. Les tables Prisma remplacent l’accès MySQL ; les anciens fichiers/routes backend ne sont pas présents dans le dossier de travail actuel.
