# Connexion Securitec

## DÃ©marrer lâ€™application

Dans deux terminaux Git Bash sÃ©parÃ©s :

```bash
cd Securitec-backend
npm run dev
```

```bash
cd Securitec-frontend
npm run dev
```

Le frontend appelle `http://localhost:5000/api` par dÃ©faut. Pour changer cette adresse, dÃ©finissez `VITE_API_URL` dans le `.env` du frontend.

## CrÃ©er un utilisateur

La connexion utilise les comptes de la table `utilisateur`. Pour crÃ©er un compte, depuis `Securitec-backend` :

```bash
npm run db:create-user
```

Le script demande le nom, lâ€™identifiant, le code numÃ©rique du rÃ´le, lâ€™UUID du site (facultatif) et un PIN Ã  6 chiffres saisi sans affichage. Le PIN est stockÃ© sous forme de hash bcrypt.

La connexion Ã  Neon doit autoriser le port PostgreSQL 5432 pour que cette commande et le backend puissent accÃ©der Ã  la base.

## Seed utilisateur (Prisma)

Pour crÃ©er un utilisateur initial de maniÃ¨re rÃ©pÃ©table, renseignez `SEED_USER_NAME`, `SEED_USER_IDENTIFIER`, `SEED_USER_ROLE` et `SEED_USER_PIN` dans le `.env` local (ainsi que `SEED_USER_SITE_ID` si nÃ©cessaire), puis lancez depuis `Securitec-backend` :

```bash
npm run db:seed
```

Le script ne pose aucune question : il lit les valeurs du `.env`, hache le PIN avec bcrypt et ne modifie pas un compte si lâ€™identifiant existe dÃ©jÃ . Ne partagez pas votre `.env` et ne commitez pas le PIN. Prisma v7 exÃ©cute le seed explicitement avec `prisma db seed`.

## API dâ€™authentification

- `POST /api/auth/login` â€” reÃ§oit `{ "identifier": "â€¦", "pin": "123456" }`, vÃ©rifie le hash bcrypt et renvoie un jeton signÃ© valable 8 heures avec le profil utilisateur.
- `GET /api/auth/me` â€” vÃ©rifie le jeton envoyÃ© dans lâ€™en-tÃªte `Authorization: Bearer â€¦` et restaure le profil.
- `GET /api/health` â€” vÃ©rifie lâ€™accÃ¨s Ã  PostgreSQL.

`JWT_SECRET` doit contenir au moins 32 caractÃ¨res. Une clÃ© locale a Ã©tÃ© ajoutÃ©e Ã  `.env`; pour une nouvelle installation, gÃ©nÃ©rez une clÃ© alÃ©atoire et placez-la dans `.env`. Ne partagez pas cette clÃ© et ne la copiez pas dans `.env.example`.

Pour verifier la connexion PostgreSQL sans ecrire de donnees, lancez `npm run db:check`.
