// Catalogue des permissions : source unique pour le backend (contrôle d'accès) et le frontend (écran des rôles).
// Une permission s'écrit « module.action », par exemple « sheets.create ».
//
// Il ne liste QUE les fonctions qui existent dans l'application. Quand une nouvelle fonction est développée
// (employés, caméras, documents…), on ajoute son module ici, puis on le donne aux rôles système avec
// `node scripts/grant-new-permissions.js <module>`.

export const ACTIONS = {
  view: "Consulter",
  create: "Créer",
  update: "Modifier",
  delete: "Supprimer",
  report: "Signaler au supérieur",
};

const CRUD = ["view", "create", "update", "delete"];
const mod = (key, label, actions = CRUD) => ({ key, label, actions });

export const PERMISSION_GROUPS = [
  {
    key: "sites_postes",
    label: "Sites et postes",
    modules: [
      // Sites, postes de garde, utilisateurs affectés, constructeur de feuilles (feuilles et colonnes).
      mod("administration", "Sites, postes de garde et feuilles (structure)"),
      // Saisie dans les feuilles : plafond du rôle ; chaque feuille peut restreindre ces droits (lecture seule, ajout, modification, suppression).
      mod("sheets", "Feuilles de saisie (lignes et fichiers)", [...CRUD, "report"]),
      // Comptes rendus : pages libres (texte + tableaux des feuilles de saisie) conçues et imprimées par le site.
      mod("minutes", "Comptes rendus"),
    ],
  },
  {
    key: "acces",
    label: "Accès et sécurité",
    modules: [mod("users", "Utilisateurs"), mod("roles", "Rôles et permissions")],
  },
  {
    key: "suivi",
    label: "Suivi du personnel",
    // Planning de toute l'agence (tous les sites) : qui est en poste, où et quand.
    modules: [mod("planning", "Planning du personnel (tous les sites)")],
  },
];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) =>
  group.modules.flatMap((module) => module.actions.map((action) => `${module.key}.${action}`)),
);

const PERMISSION_SET = new Set(ALL_PERMISSIONS);
export const isKnownPermission = (permission) => PERMISSION_SET.has(permission);

// Profils de base : ils déterminent le périmètre (profil 1 = tous les sites ; les autres sont limités à leur site).
export const PROFILES = {
  1: "Administrateur",
  2: "Chef de poste",
  3: "Responsable sécurité",
  4: "Direction",
  5: "Agent APS",
};

const grant = (modules, actions) =>
  modules.flatMap((key) => actions.filter((action) => PERMISSION_SET.has(`${key}.${action}`)).map((action) => `${key}.${action}`));

/**
 * Permissions par défaut de chaque profil.
 * La structure (sites, postes, feuilles) et les comptes sont réservés à l'administrateur ; les autres profils saisissent dans les feuilles
 * du poste auquel ils sont affectés (en plus, chaque feuille limite ce qu'on peut y faire).
 */
export const DEFAULT_PERMISSIONS_BY_PROFILE = {
  1: ALL_PERMISSIONS,
  2: [...grant(["sheets"], ["view", "create", "update", "report"]), ...grant(["minutes"], CRUD)],
  3: [...grant(["sheets"], CRUD), ...grant(["minutes"], CRUD)],
  4: grant(["planning"], CRUD),
  5: grant(["sheets"], ["view", "create", "report"]),
};

export const SYSTEM_ROLES = [
  { code: "administrateur", nom: PROFILES[1], profilBase: 1, description: "Accès complet à l'application." },
  { code: "chef_de_poste", nom: PROFILES[2], profilBase: 2, description: "Saisit et modifie les feuilles de son poste." },
  { code: "responsable_securite", nom: PROFILES[3], profilBase: 3, description: "Saisit, modifie et supprime dans les feuilles de son poste." },
  { code: "direction", nom: PROFILES[4], profilBase: 4, description: "Aucun accès par défaut : à définir selon les besoins." },
  { code: "agent_aps", nom: PROFILES[5], profilBase: 5, description: "Saisit dans les feuilles de son poste." },
];
