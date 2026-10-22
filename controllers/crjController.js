
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
// Options des sélecteurs (prestataire + site de travail) : UNE seule requête
// ---------------------------------------------------------------------------
export async function getCrjOptions(pool) {
  const res = await pool.query(
    `SELECT
       COALESCE((SELECT json_agg(t ORDER BY t.nom)
                 FROM (SELECT id, nom FROM prestataire WHERE actif = true) t), '[]'::json) AS prestataires,
       COALESCE((SELECT json_agg(t ORDER BY t.nom)
                 FROM (SELECT id, nom, type_site AS "typeSite" FROM site WHERE actif = true) t), '[]'::json) AS sites;`
  );
  return res.rows[0];
}

// ---------------------------------------------------------------------------
// Requête unique : toutes les rubriques du CRJ en un seul aller-retour vers la base
// ($1 = site, $2 = prestataire, $3 = date). Chaque rubrique revient en tableau JSON.
// ---------------------------------------------------------------------------
const SQL_CRJ = `
WITH s AS (SELECT id, nom, type_site FROM site WHERE id = $1::uuid),
     p AS (SELECT id, nom FROM prestataire WHERE id = $2::uuid)
SELECT
  (SELECT row_to_json(s) FROM s) AS site,
  (SELECT row_to_json(p) FROM p) AS prestataire,

  -- 1 - Agents : prises de poste du jour pour ce prestataire et ce site
  COALESCE((
    SELECT json_agg(a ORDER BY a.started_at) FROM (
      SELECT pp.matricule, pp.nom, pp.prenom, pp.started_at,
             EXTRACT(HOUR FROM ${local("pp.started_at")})::int AS heure_debut
      FROM prise_de_poste pp, s, p
      WHERE UPPER(TRIM(pp.prestataire)) = UPPER(TRIM(p.nom))
        AND UPPER(TRIM(pp.site_de_travail)) = UPPER(TRIM(s.nom))
        AND ${local("pp.started_at")}::date = $3::date
    ) a
  ), '[]'::json) AS agents,

  -- 2 - Clés : perceptions du jour + leur réintégration (via perception_id)
  COALESCE((
    SELECT json_agg(k ORDER BY k.created_at) FROM (
      SELECT sc.id, sc.trousse_cle, sc.lieu, sc.personne_habilitee, sc.heure, sc.created_at,
             to_char(${localTz("sc.created_at")}, 'HH24:MI') AS heure_saisie,
             r.personne_habilitee AS reint_personne,
             r.heure AS reint_heure,
             to_char(${localTz("r.created_at")}, 'HH24:MI') AS reint_heure_saisie
      FROM suivi_cle sc
      LEFT JOIN LATERAL (
        SELECT r1.personne_habilitee, r1.heure, r1.created_at
        FROM suivi_cle r1
        WHERE r1.action = 'Réintégration' AND r1.perception_id = sc.id
        ORDER BY r1.created_at
        LIMIT 1
      ) r ON true
      CROSS JOIN s
      CROSS JOIN p
      WHERE sc.action = 'Perception'
        AND ${localTz("sc.created_at")}::date = $3::date
        AND (
          EXISTS (
            SELECT 1 FROM employe e
            WHERE UPPER(TRIM(e.matricule)) = UPPER(TRIM(sc.agent_gardien))
              AND e.site_id = s.id AND e.prestataire_id = p.id
          )
          OR EXISTS (
            SELECT 1 FROM prise_de_poste pp2
            WHERE UPPER(TRIM(pp2.matricule)) = UPPER(TRIM(sc.agent_gardien))
              AND UPPER(TRIM(pp2.site_de_travail)) = UPPER(TRIM(s.nom))
              AND UPPER(TRIM(pp2.prestataire)) = UPPER(TRIM(p.nom))
              AND ${local("pp2.started_at")}::date = $3::date
          )
        )
    ) k
  ), '[]'::json) AS cles,

  -- 3, 4, 5 - Flux logistiques
  COALESCE((
    SELECT json_agg(f ORDER BY f.cree_le) FROM (
      SELECT type_flux, camion, transporteur, document, plomb, article, quantite, cree_le
      FROM flux_logistique
      WHERE site_id = $1::uuid AND date_operation = $3::date
    ) f
  ), '[]'::json) AS flux,

  -- Alcootests
  COALESCE((
    SELECT json_agg(a ORDER BY a.heure) FROM (
      SELECT to_char(heure, 'HH24:MI') AS heure, personne, appartenance, demandeur,
             type_demande, resultat, taux_mesure
      FROM controle_alcoolemie
      WHERE site_id = $1::uuid AND date_controle = $3::date
    ) a
  ), '[]'::json) AS alcootests,

  -- Rondes
  COALESCE((
    SELECT json_agg(r ORDER BY r.debut) FROM (
      SELECT nom_parcours, observations,
             to_char(${local("debut")}, 'HH24:MI') AS debut,
             to_char(${local("fin")}, 'HH24:MI') AS fin
      FROM ronde
      WHERE site_id = $1::uuid AND ${local("debut")}::date = $3::date
    ) r
  ), '[]'::json) AS rondes,

  -- Points de vigilance
  COALESCE((
    SELECT json_agg(v ORDER BY v.heure) FROM (
      SELECT to_char(heure, 'HH24:MI') AS heure, type_point, element_verifie, statut, agent_nom, observations
      FROM point_vigilance
      WHERE site_id = $1::uuid AND ${local("cree_le")}::date = $3::date
    ) v
  ), '[]'::json) AS vigilance,

  -- Anomalies = signalements logistiques
  COALESCE((
    SELECT json_agg(x ORDER BY x.heure) FROM (
      SELECT to_char(heure, 'HH24:MI') AS heure, type_signalement, camion, transporteur, document,
             casse, manquant, vides, phn, description_faits, observations
      FROM signalement_logistique
      WHERE site_id = $1::uuid AND date_operation = $3::date
    ) x
  ), '[]'::json) AS signalements,

  -- Violations de procédure et divers = main courante
  COALESCE((
    SELECT json_agg(m ORDER BY m.heure) FROM (
      SELECT to_char(heure, 'HH24:MI') AS heure, category, people, nature_violation, type_entree,
             description, mesures_prises
      FROM main_courante
      WHERE site_id = $1::uuid AND ${local("cree_le")}::date = $3::date
    ) m
  ), '[]'::json) AS main_courante;
`;

// ---------------------------------------------------------------------------
// Génération du CRJ à partir des activités enregistrées
// ---------------------------------------------------------------------------
export async function generateCrj({ prestataireId, siteId, date }, pool) {
  const day = date || aujourdhui();
  if (!UUID.test(txt(prestataireId))) throw fail(400, "Prestataire invalide.");
  if (!UUID.test(txt(siteId))) throw fail(400, "Site de travail invalide.");
  if (!DATE.test(day)) throw fail(400, "Date invalide (format attendu : AAAA-MM-JJ).");

  const res = await pool.query(SQL_CRJ, [siteId, prestataireId, day]);
  const d = res.rows[0];
  if (!d?.site) throw fail(404, "Site introuvable.");
  if (!d?.prestataire) throw fail(404, "Prestataire introuvable.");

  const siteType = d.site.type_site === "AGENCE" ? "Agence" : "Usine";

  // --- 1 - Agents jour / nuit (dédoublonnés par matricule) ---
  const agentsJour = [];
  const agentsNuit = [];
  const vus = new Set();
  for (const a of d.agents) {
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
  for (const f of d.flux) {
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
  const alcootests = d.alcootests.map((a) => ({
    heure: a.heure,
    nomPrenom: txt(a.personne),
    isStar: /^STAR/.test(norm(a.appartenance)),
    demandeur: txt(a.demandeur) || undefined,
    resultat: txt(a.resultat),
    typeControle: txt(a.type_demande),
    taux: a.taux_mesure === null || a.taux_mesure === undefined ? undefined : String(a.taux_mesure),
  }));

  // --- Rondes ---
  const rondes = d.rondes.map((r) => ({
    debut: r.debut || "-",
    fin: r.fin || "-",
    obs: txt(r.observations) || txt(r.nom_parcours) || "-",
  }));

  // --- Points de vigilance ---
  const pointsVigilance = d.vigilance.map((v) => ({
    heure: v.heure,
    typePoint: txt(v.type_point) || "-",
    element: txt(v.element_verifie) || "-",
    statut: txt(v.statut) || "-",
    agent: txt(v.agent_nom) || "-",
    obs: txt(v.observations) || "-",
  }));

  // --- Anomalies ---
  const anomalies = d.signalements.map((s) => ({
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
  for (const m of d.main_courante) {
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
    prestataire: d.prestataire.nom,
    siteNom: d.site.nom,
    date: `${jour}/${mois}/${annee}`,
    agentsJour,
    agentsNuit,
    cles: construireCles(d.cles),
    dechargements,
    chargements,
    stockExterieur: siteType === "Agence" ? stock : undefined,
    alcootests,
    rondes,
    pointsVigilance,
    anomalies,
    violations,
    divers,
  };
}

// ---------------------------------------------------------------------------
// Clés : une ligne par trousseau, avec les cycles MATIN et APRES-MIDI.
// Le cycle d'une clé dépend de l'heure de sa perception (avant 12h = matin).
// Sa réintégration (reint_*) est rattachée à la même ligne et au même cycle.
// Une clé appartient au site/prestataire de son agent gardien (matricule).
// ---------------------------------------------------------------------------
function construireCles(perceptions) {
  const lignes = [];
  const index = new Map(); // trousseau -> lignes existantes

  for (const p of perceptions) {
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

    if (p.reint_heure_saisie || p.reint_personne) {
      ligne[`reint${cycle}`] = hhmm(p.reint_heure) || p.reint_heure_saisie;
      ligne[`respReint${cycle}`] = txt(p.reint_personne);
    }
  }

  return lignes;
}
