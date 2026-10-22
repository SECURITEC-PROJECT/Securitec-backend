import pool from "../config/db.js";

// ---------------------------------------------------------------------------
// Réglages à adapter si besoin
// ---------------------------------------------------------------------------
const TZ = "Indian/Antananarivo";

// Une prise de poste commencée entre ces heures (locales) = poste de JOUR, sinon NUIT
const JOUR_DEBUT = 5;
const JOUR_FIN = 17;

// Types de flux logistiques (comparés sans accents ni majuscules, début de mot)
const DECHARGEMENT = /^(DECH|RECEP|ENTR)/;
const CHARGEMENT = /^(CHARG|EXPED|SORT)/;

// Articles du stock extérieur (Agence) : clé du rapport -> début du code article
const ARTICLES_STOCK = {
  cv12: "CV12",
  cv24: "CV24",
  cv20: "CV20",
  intercalaires: "INTERCAL",
  ev150: "EV150",
  ev50: "EV50",
  cr200: "CR200",
  cr100: "CR100",
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (status, message) => Object.assign(new Error(message), { status });
const txt = (v) => (v === null || v === undefined ? "" : String(v).trim());
const norm = (v) => txt(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const hhmm = (v) => {
  const m = /(\d{1,2})[:h](\d{2})/.exec(txt(v));
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
};
const aujourdhui = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

// Colonne "timestamp sans fuseau" (écrite en UTC par le serveur) -> heure locale
const local = (col) => `((${col} AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')`;
// Colonne "timestamptz" -> heure locale
const localTz = (col) => `(${col} AT TIME ZONE '${TZ}')`;

// ---------------------------------------------------------------------------
// Options des sélecteurs (prestataire + site de travail)
// ---------------------------------------------------------------------------
export async function getCrjOptions() {
  const [prestataires, sites] = await Promise.all([
    pool.query(`SELECT id, nom FROM prestataire WHERE actif = true ORDER BY nom ASC;`),
    pool.query(`SELECT id, nom, type_site AS "typeSite" FROM site WHERE actif = true ORDER BY nom ASC;`),
  ]);
  return { prestataires: prestataires.rows, sites: sites.rows };
}

// ---------------------------------------------------------------------------
// Génération du CRJ à partir des activités enregistrées
// ---------------------------------------------------------------------------
export async function generateCrj({ prestataireId, siteId, date }) {
  const day = date || aujourdhui();
  if (!UUID.test(txt(prestataireId))) throw fail(400, "Prestataire invalide.");
  if (!UUID.test(txt(siteId))) throw fail(400, "Site de travail invalide.");
  if (!DATE.test(day)) throw fail(400, "Date invalide (format attendu : AAAA-MM-JJ).");

  const [siteRes, prestRes] = await Promise.all([
    pool.query(`SELECT id, nom, type_site FROM site WHERE id = $1::uuid;`, [siteId]),
    pool.query(`SELECT id, nom FROM prestataire WHERE id = $1::uuid;`, [prestataireId]),
  ]);
  const site = siteRes.rows[0];
  const prestataire = prestRes.rows[0];
  if (!site) throw fail(404, "Site introuvable.");
  if (!prestataire) throw fail(404, "Prestataire introuvable.");

  const siteType = site.type_site === "AGENCE" ? "Agence" : "Usine";

  const [agentsRes, cles, fluxRes, alcoolRes, rondesRes, signalRes, mcRes] = await Promise.all([
    // 1 - Agents : prises de poste du jour pour ce prestataire et ce site
    pool.query(
      `SELECT matricule, nom, prenom,
              EXTRACT(HOUR FROM ${local("started_at")})::int AS heure_debut
       FROM prise_de_poste
       WHERE UPPER(TRIM(prestataire)) = UPPER(TRIM($1::text))
         AND UPPER(TRIM(site_de_travail)) = UPPER(TRIM($2::text))
         AND ${local("started_at")}::date = $3::date
       ORDER BY started_at;`,
      [prestataire.nom, site.nom, day]
    ),
    // 2 - Clés
    chargerCles({ day, siteId, prestataireId, siteNom: site.nom, prestataireNom: prestataire.nom }),
    // 3, 4, 5 - Flux logistiques
    pool.query(
      `SELECT type_flux, camion, transporteur, document, plomb, article, quantite
       FROM flux_logistique
       WHERE site_id = $1::uuid AND date_operation = $2::date
       ORDER BY cree_le;`,
      [siteId, day]
    ),
    // Alcootests
    pool.query(
      `SELECT to_char(heure, 'HH24:MI') AS heure, personne, appartenance, demandeur,
              type_demande, resultat, taux_mesure
       FROM controle_alcoolemie
       WHERE site_id = $1::uuid AND date_controle = $2::date
       ORDER BY heure;`,
      [siteId, day]
    ),
    // Rondes
    pool.query(
      `SELECT nom_parcours, observations,
              to_char(${local("debut")}, 'HH24:MI') AS debut,
              to_char(${local("fin")}, 'HH24:MI') AS fin
       FROM ronde
       WHERE site_id = $1::uuid AND ${local("debut")}::date = $2::date
       ORDER BY debut;`,
      [siteId, day]
    ),
    // Anomalies = signalements logistiques
    pool.query(
      `SELECT to_char(heure, 'HH24:MI') AS heure, type_signalement, camion, transporteur, document,
              casse, manquant, vides, phn, description_faits, observations
       FROM signalement_logistique
       WHERE site_id = $1::uuid AND date_operation = $2::date
       ORDER BY heure;`,
      [siteId, day]
    ),
    // Violations de procédure et divers = main courante
    pool.query(
      `SELECT to_char(heure, 'HH24:MI') AS heure, category, people, nature_violation, type_entree,
              description, mesures_prises
       FROM main_courante
       WHERE site_id = $1::uuid AND ${local("cree_le")}::date = $2::date
       ORDER BY heure;`,
      [siteId, day]
    ),
  ]);

  // --- 1 - Agents jour / nuit (dédoublonnés par matricule) ---
  const agentsJour = [];
  const agentsNuit = [];
  const vus = new Set();
  for (const a of agentsRes.rows) {
    const estJour = a.heure_debut >= JOUR_DEBUT && a.heure_debut < JOUR_FIN;
    const cle = `${estJour ? "J" : "N"}|${norm(a.matricule)}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    const agent = { nom: `${txt(a.nom)} ${txt(a.prenom)}`.trim(), matricule: txt(a.matricule) };
    (estJour ? agentsJour : agentsNuit).push(agent);
  }

  // --- 3, 4, 5 - Déchargements, chargements, stock extérieur ---
  const dechargements = [];
  const chargements = [];
  const stock = Object.fromEntries(Object.keys(ARTICLES_STOCK).map((k) => [k, 0]));
  for (const f of fluxRes.rows) {
    const ligne = {
      camion: txt(f.camion) || "-",
      transporteur: txt(f.transporteur) || "-",
      titre: txt(f.document) || "-",
      plomb: txt(f.plomb) || "-",
    };
    const type = norm(f.type_flux);
    if (DECHARGEMENT.test(type)) dechargements.push(ligne);
    else if (CHARGEMENT.test(type)) chargements.push(ligne);

    const article = norm(f.article).replace(/[^A-Z0-9]/g, "");
    for (const [cle, code] of Object.entries(ARTICLES_STOCK)) {
      if (article.startsWith(code)) stock[cle] += Number(f.quantite) || 0;
    }
  }

  // --- Alcootests ---
  const alcootests = alcoolRes.rows.map((a) => ({
    heure: a.heure,
    nomPrenom: txt(a.personne),
    isStar: /^STAR/.test(norm(a.appartenance)),
    demandeur: txt(a.demandeur) || undefined,
    resultat: txt(a.resultat),
    typeControle: txt(a.type_demande),
    taux: a.taux_mesure === null ? undefined : String(a.taux_mesure),
  }));

  // --- Rondes ---
  const rondes = rondesRes.rows.map((r) => ({
    debut: r.debut || "-",
    fin: r.fin || "-",
    obs: txt(r.observations) || txt(r.nom_parcours) || "-",
  }));

  // --- Anomalies ---
  const anomalies = signalRes.rows.map((s) => ({
    heure: s.heure,
    camion: txt(s.camion) || "-",
    transporteur: txt(s.transporteur) || "-",
    titre: txt(s.document) || "-",
    obs:
      [
        txt(s.type_signalement),
        txt(s.casse) && `Casse : ${txt(s.casse)}`,
        txt(s.manquant) && `Manquant : ${txt(s.manquant)}`,
        txt(s.vides) && `Vides : ${txt(s.vides)}`,
        txt(s.phn) && `PHN : ${txt(s.phn)}`,
        txt(s.description_faits),
        txt(s.observations),
      ]
        .filter(Boolean)
        .join(" — ") || "-",
  }));

  // --- Violations de procédure / divers (main courante) ---
  const violations = [];
  const divers = [];
  for (const m of mcRes.rows) {
    const estViolation = txt(m.nature_violation) !== "" || /^VIOLATION/.test(norm(m.type_entree));
    if (estViolation) {
      violations.push({
        heure: m.heure,
        nomPrenom: txt(m.people) || "-",
        obs: [txt(m.nature_violation), txt(m.description)].filter(Boolean).join(" — ") || "-",
        mesures: txt(m.mesures_prises) || "-",
      });
    } else {
      divers.push({
        dateHeure: m.heure,
        faits: [txt(m.category), txt(m.description)].filter(Boolean).join(" — ") || "-",
        mesures: txt(m.mesures_prises) || "-",
      });
    }
  }

  const [annee, mois, jour] = day.split("-");

  return {
    siteType,
    prestataire: prestataire.nom,
    siteNom: site.nom,
    date: `${jour}/${mois}/${annee}`,
    agentsJour,
    agentsNuit,
    cles,
    dechargements,
    chargements,
    stockExterieur: siteType === "Agence" ? stock : undefined,
    alcootests,
    rondes,
    anomalies,
    violations,
    divers,
  };
}

// ---------------------------------------------------------------------------
// Clés : une ligne par trousseau, avec les cycles MATIN et APRES-MIDI.
// Le cycle d'une clé dépend de l'heure de sa perception (avant 12h = matin).
// La réintégration est rattachée à sa perception via perception_id.
// Une clé appartient au site/prestataire de son agent gardien (matricule).
// ---------------------------------------------------------------------------
async function chargerCles({ day, siteId, prestataireId, siteNom, prestataireNom }) {
  const perceptions = await pool.query(
    `SELECT s.id, s.trousse_cle, s.lieu, s.personne_habilitee, s.heure,
            to_char(${localTz("s.created_at")}, 'HH24:MI') AS heure_saisie
     FROM suivi_cle s
     WHERE s.action = 'Perception'
       AND ${localTz("s.created_at")}::date = $1::date
       AND (
         EXISTS (
           SELECT 1 FROM employe e
           WHERE UPPER(TRIM(e.matricule)) = UPPER(TRIM(s.agent_gardien))
             AND e.site_id = $2::uuid AND e.prestataire_id = $3::uuid
         )
         OR EXISTS (
           SELECT 1 FROM prise_de_poste p
           WHERE UPPER(TRIM(p.matricule)) = UPPER(TRIM(s.agent_gardien))
             AND UPPER(TRIM(p.site_de_travail)) = UPPER(TRIM($4::text))
             AND UPPER(TRIM(p.prestataire)) = UPPER(TRIM($5::text))
             AND ${local("p.started_at")}::date = $1::date
         )
       )
     ORDER BY s.created_at;`,
    [day, siteId, prestataireId, siteNom, prestataireNom]
  );

  const ids = perceptions.rows.map((p) => p.id);
  const reintegrations = ids.length
    ? await pool.query(
        `SELECT perception_id, personne_habilitee, heure,
                to_char(${localTz("created_at")}, 'HH24:MI') AS heure_saisie
         FROM suivi_cle
         WHERE action = 'Réintégration' AND perception_id = ANY($1::int[])
         ORDER BY created_at;`,
        [ids]
      )
    : { rows: [] };

  const reintParPerception = new Map();
  for (const r of reintegrations.rows) reintParPerception.set(r.perception_id, r);

  const lignes = [];
  const index = new Map(); // trousseau -> lignes existantes

  for (const p of perceptions.rows) {
    const heurePerception = hhmm(p.heure) || p.heure_saisie;
    const cycle = parseInt(heurePerception.slice(0, 2), 10) < 12 ? "Matin" : "ApresMidi";

    const trousseau = txt(p.trousse_cle);
    const lieu = txt(p.lieu);
    const libelle = lieu ? `${lieu} (${trousseau})` : trousseau;
    const cle = norm(`${trousseau}|${lieu}`);

    const existantes = index.get(cle) ?? [];
    let ligne = existantes.find((l) => !l[`perc${cycle}`]);
    if (!ligne) {
      ligne = { lieu: libelle };
      existantes.push(ligne);
      lignes.push(ligne);
      index.set(cle, existantes);
    }

    ligne[`perc${cycle}`] = heurePerception;
    ligne[`respPerc${cycle}`] = txt(p.personne_habilitee);

    const r = reintParPerception.get(p.id);
    if (r) {
      ligne[`reint${cycle}`] = hhmm(r.heure) || r.heure_saisie;
      ligne[`respReint${cycle}`] = txt(r.personne_habilitee);
    }
  }

  return lignes;
}
