import pool from "../config/db.js";

// ---------------------------------------------------------------------------
// Réglages
// ---------------------------------------------------------------------------
const TZ = "Indian/Antananarivo";

// Heure de fermeture utilisée si le site n'a pas d'horaires lisibles (ex. "08:00 - 17:00")
const FERMETURE_PAR_DEFAUT = { h: 18, m: 0 };

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
const txt = (v) => (v === null || v === undefined ? "" : String(v).trim());
const deux = (n) => String(n).padStart(2, "0");

// Colonne "timestamp sans fuseau" (écrite en UTC par le serveur) -> heure locale
const local = (col) => `((${col} AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')`;

// Heure locale actuelle, exprimée en millisecondes "naïves" (comparables aux heures d'entrée)
function maintenantLocalMs() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

// Lit les horaires d'un site : "08:00 - 17:00", "7h-17h30"… (premier = ouverture, dernier = fermeture)
function lireFermeture(horaires) {
  const heures = [...txt(horaires).matchAll(/(\d{1,2})\s*(?:h|:)\s*(\d{2})?/gi)]
    .map((m) => ({ h: Number(m[1]), m: Number(m[2] ?? 0) }))
    .filter((t) => t.h <= 23 && t.m <= 59);
  if (heures.length >= 2) return { fermeture: heures[heures.length - 1], parDefaut: false };
  return { fermeture: FERMETURE_PAR_DEFAUT, parDefaut: true };
}

function dureeTexte(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const jours = Math.floor(minutes / 1440);
  const heures = Math.floor((minutes % 1440) / 60);
  const reste = minutes % 60;
  if (jours > 0) return `${jours} j ${heures} h`;
  return `${heures} h ${deux(reste)}`;
}

// Retourne les infos d'anomalie si la personne/le véhicule est encore là après la fermeture
function evaluer(row, nowMs) {
  const [jour, heure] = txt(row.entree_locale).split("T");
  if (!jour || !heure) return null;
  const [Y, M, D] = jour.split("-").map(Number);
  const [hh, mm, ss] = heure.split(":").map(Number);
  const entreeMs = Date.UTC(Y, M - 1, D, hh, mm, ss || 0);

  const { fermeture, parDefaut } = lireFermeture(row.horaires_ouverture);

  // Première fermeture qui suit l'entrée
  let fermetureMs = Date.UTC(Y, M - 1, D, fermeture.h, fermeture.m, 0);
  if (fermetureMs < entreeMs) fermetureMs += 24 * 3600 * 1000;

  if (nowMs <= fermetureMs) return null;

  const retardMinutes = Math.floor((nowMs - fermetureMs) / 60000);
  return {
    dateEntree: `${deux(D)}/${deux(M)}/${Y}`,
    heureEntree: `${deux(hh)}:${deux(mm)}`,
    heureFermeture: `${deux(fermeture.h)}:${deux(fermeture.m)}`,
    fermetureParDefaut: parDefaut,
    retardMinutes,
    retardTexte: dureeTexte(retardMinutes),
  };
}

const ligne = (label, valeur) => (txt(valeur) ? { label, valeur: txt(valeur) } : null);

// ---------------------------------------------------------------------------
// Visiteurs et véhicules encore présents après la fermeture de leur site
// (une seule requête vers la base)
// ---------------------------------------------------------------------------
const SQL = `
SELECT
  COALESCE((
    SELECT json_agg(t ORDER BY t.entree_locale) FROM (
      SELECT p.id, v.identite, v.societe, p.hote, p.motif, p.zone, p.materiel,
             COALESCE(NULLIF(TRIM(p.badge_numero), ''), b.uid_nfc) AS badge,
             to_char(${local("p.entree")}, 'YYYY-MM-DD"T"HH24:MI:SS') AS entree_locale,
             s.nom AS site_nom, s.horaires_ouverture
      FROM passage p
      LEFT JOIN visiteur v ON v.id = p.visiteur_id
      LEFT JOIN badge b ON b.id = p.badge_id
      LEFT JOIN site s ON s.id = v.site_id
      WHERE p.sortie IS NULL
    ) t
  ), '[]'::json) AS visiteurs,
  COALESCE((
    SELECT json_agg(t ORDER BY t.entree_locale) FROM (
      SELECT pv.id, ve.immatriculation, ve.type, pv.transporteur, pv.conducteur, pv.passagers,
             pv.motif, pv.zone, pv.operation, pv.reference, pv.plomb, pv.etat_chargement,
             to_char(${local("pv.entree")}, 'YYYY-MM-DD"T"HH24:MI:SS') AS entree_locale,
             s.nom AS site_nom, s.horaires_ouverture
      FROM passage_vehicule pv
      JOIN vehicule ve ON ve.id = pv.vehicule_id
      LEFT JOIN site s ON s.id = pv.site_id
      WHERE pv.sortie IS NULL
    ) t
  ), '[]'::json) AS vehicules;
`;

export async function getAnomaliesSorties() {
  const res = await pool.query(SQL);
  const { visiteurs, vehicules } = res.rows[0];
  const nowMs = maintenantLocalMs();
  const anomalies = [];

  for (const v of visiteurs) {
    const a = evaluer(v, nowMs);
    if (!a) continue;
    const nom = txt(v.identite) || "Visiteur inconnu";
    const site = txt(v.site_nom) || "site non renseigné";
    anomalies.push({
      id: `visiteur-${v.id}`,
      type: "visiteur",
      rowId: String(v.id),
      titre: "Visiteur non sorti après la fermeture",
      message: `${nom}${txt(v.societe) ? ` (${txt(v.societe)})` : ""} est entré le ${a.dateEntree} à ${a.heureEntree} sur « ${site} » et n'est pas ressorti. Fermeture à ${a.heureFermeture} dépassée de ${a.retardTexte}.`,
      site: txt(v.site_nom),
      zone: txt(v.zone),
      ...a,
      lignes: [
        ligne("Visiteur", nom),
        ligne("Société", v.societe),
        ligne("Personne visitée", v.hote),
        ligne("Badge", v.badge),
        ligne("Motif", v.motif),
        ligne("Zone", v.zone),
        ligne("Matériel", v.materiel),
        ligne("Site", v.site_nom),
        ligne("Entrée", `${a.dateEntree} à ${a.heureEntree}`),
        ligne("Fermeture", `${a.heureFermeture}${a.fermetureParDefaut ? " (par défaut)" : ""}`),
        ligne("Dépassement", a.retardTexte),
      ].filter(Boolean),
    });
  }

  for (const v of vehicules) {
    const a = evaluer(v, nowMs);
    if (!a) continue;
    const plaque = txt(v.immatriculation) || "Véhicule inconnu";
    const site = txt(v.site_nom) || "site non renseigné";
    anomalies.push({
      id: `vehicule-${v.id}`,
      type: "vehicule",
      rowId: String(v.id),
      titre: "Véhicule non sorti après la fermeture",
      message: `Le véhicule ${plaque}${txt(v.conducteur) ? ` (conducteur : ${txt(v.conducteur)})` : ""} est entré le ${a.dateEntree} à ${a.heureEntree} sur « ${site} » et n'est pas ressorti. Fermeture à ${a.heureFermeture} dépassée de ${a.retardTexte}.`,
      site: txt(v.site_nom),
      zone: txt(v.zone),
      ...a,
      lignes: [
        ligne("Immatriculation", plaque),
        ligne("Type", v.type),
        ligne("Conducteur", v.conducteur),
        ligne("Transporteur", v.transporteur),
        ligne("Passagers", v.passagers),
        ligne("Opération", v.operation),
        ligne("Motif", v.motif),
        ligne("Zone", v.zone),
        ligne("Plomb", v.plomb),
        ligne("Titre / facture", v.reference),
        ligne("État du chargement", v.etat_chargement),
        ligne("Site", v.site_nom),
        ligne("Entrée", `${a.dateEntree} à ${a.heureEntree}`),
        ligne("Fermeture", `${a.heureFermeture}${a.fermetureParDefaut ? " (par défaut)" : ""}`),
        ligne("Dépassement", a.retardTexte),
      ].filter(Boolean),
    });
  }

  // Les plus gros dépassements d'abord
  anomalies.sort((x, y) => y.retardMinutes - x.retardMinutes);
  return anomalies;
}