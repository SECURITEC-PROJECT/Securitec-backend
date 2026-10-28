
// ---------------------------------------------------------------------------
// Réglages à adapter si besoin
// ---------------------------------------------------------------------------
const TZ = "Indian/Antananarivo";

// Types de flux logistiques (comparés sans accents ni majuscules, début de mot)
const DECHARGEMENT = /^(DECH|RECEP|ENTR)/;
const CHARGEMENT = /^(CHARG|EXPED|SORT)/;

// Postes et effectifs de référence du formulaire Pointage APS
const POSTES_JOUR = [
  ["PG1", 5], ["EXP", 2], ["BOX", 1], ["EX GARAGE", 1], ["MG/HV", 1],
  ["TDE", 1], ["BON ESPOIR", 2], ["CO2", 1], ["PG2", 2], ["PBM", 1],
  ["PBS", 1], ["PARKING EXTERIEUR", 1], ["MATERIEL", 1], ["FITAVA", 1], ["VILLA G", 1],
];
const POSTES_NUIT = [
  ["PG1", 2], ["EXP", 1], ["BOX", 1], ["EX GARAGE", 1], ["MG/HV", 1],
  ["TDE", 1], ["BON ESPOIR", 3], ["CO2", 1], ["PG2", 2], ["MATO", 2],
  ["FITAVA", 1], ["VILLA G", 1],
];

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

  -- 1 - Agents : pointages APS enregistrés pour le site et la date sélectionnés
  COALESCE((
    SELECT json_agg(json_build_object(
      'service', a.service,
      'poste', a.poste,
      'prenom', a.agent->>'prenom',
      'matricule', a.agent->>'matricule',
      'nom_employe', e.nom,
      'prenom_employe', e.prenom
    ) ORDER BY a.service, a.poste, a.position)
    FROM (
      SELECT 'jour' AS service, poste.key AS poste, agent.value AS agent, agent.position
      FROM pointage_aps_jour pa
      CROSS JOIN LATERAL jsonb_each(pa.data) AS poste(key, value)
      CROSS JOIN LATERAL jsonb_array_elements(poste.value) WITH ORDINALITY AS agent(value, position)
      WHERE pa.site_id = $1::uuid AND pa.date_pointage = $3::date
      UNION ALL
      SELECT 'nuit' AS service, poste.key AS poste, agent.value AS agent, agent.position
      FROM pointage_aps_nuit pa
      CROSS JOIN LATERAL jsonb_each(pa.data) AS poste(key, value)
      CROSS JOIN LATERAL jsonb_array_elements(poste.value) WITH ORDINALITY AS agent(value, position)
      WHERE pa.site_id = $1::uuid AND pa.date_pointage = $3::date
    ) a
    LEFT JOIN employe e
      ON UPPER(TRIM(e.matricule)) = UPPER(TRIM(a.agent->>'matricule'))
  ), '[]'::json) AS agents,
  EXISTS (
    SELECT 1 FROM pointage_aps_jour pa
    WHERE pa.site_id = $1::uuid AND pa.date_pointage = $3::date
  ) AS pointage_aps_jour_enregistre,
  EXISTS (
    SELECT 1 FROM pointage_aps_nuit pa
    WHERE pa.site_id = $1::uuid AND pa.date_pointage = $3::date
  ) AS pointage_aps_nuit_enregistre,

  -- 2 - Clés : perceptions du jour + leur réintégration (via perception_id)
  COALESCE((
    SELECT json_agg(k ORDER BY k.created_at) FROM (
      SELECT sc.id, COALESCE(sc.type_cle, sc.trousse_cle) AS trousse_cle,
             COALESCE(sc.lieu, '') AS lieu,
             COALESCE(
               NULLIF(TRIM(CONCAT_WS(' ', NULLIF(sc.nom_personne, ''), NULLIF(sc.prenom_personne, ''))), ''),
               sc.personne_habilitee
             ) AS personne_habilitee,
             COALESCE(NULLIF(sc.heure, ''), to_char(sc.heure_sortie, 'HH24:MI')) AS heure,
             COALESCE(sc.cree_le, sc.created_at) AS created_at,
             to_char(${localTz("COALESCE(sc.cree_le, sc.created_at)")}, 'HH24:MI') AS heure_saisie,
             COALESCE(
               r.personne_habilitee,
               NULLIF(TRIM(CONCAT_WS(' ', NULLIF(sc.nom_personne, ''), NULLIF(sc.prenom_personne, ''))), '')
             ) AS reint_personne,
             COALESCE(r.heure, to_char(sc.heure_retour, 'HH24:MI')) AS reint_heure,
             COALESCE(
               to_char(${localTz("r.created_at")}, 'HH24:MI'),
               to_char(sc.heure_retour, 'HH24:MI')
             ) AS reint_heure_saisie
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
      WHERE (sc.action = 'Perception' OR sc.type_cle IS NOT NULL)
    AND sc.date_suivi = $3::date
        AND (
          EXISTS (
            SELECT 1 FROM employe e
          WHERE UPPER(TRIM(e.matricule)) = UPPER(TRIM(COALESCE(NULLIF(sc.agent_gardien, ''), sc.matricule_personne)))
            AND (e.site_id = s.id OR (e.site_id IS NULL AND sc.site_id = s.id))
            AND e.prestataire_id = p.id
        )
        OR EXISTS (
          SELECT 1 FROM prise_de_poste pp2
          WHERE UPPER(TRIM(pp2.matricule)) = UPPER(TRIM(COALESCE(NULLIF(sc.agent_gardien, ''), sc.matricule_personne)))
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
      SELECT type_flux, camion, immatriculation_vehicule, vehicule, transporteur,
             nom_chauffeur, chauffeur, magasinier, cree, proprietaire,
             document, facture, numero_titre, titre, plomb,
             article, quantite, categorie_stock, cree_le,
             to_char(heure_arrivee, 'HH24:MI') AS heure_arrivee,
             to_char(heure_sortie, 'HH24:MI') AS heure_sortie,
             to_char(heure_pointe, 'HH24:MI') AS heure_pointe,
             designation, nbr, quantite_texte, destinataire, provenance, poids,
             numero_pesage, details_bouteilles
      FROM flux_logistique
      WHERE site_id = $1::uuid AND date_operation = $3::date
    ) f
  ), '[]'::json) AS flux,

  -- Dernier relevé de stock de la journée pour chaque article et catégorie
  COALESCE((
    SELECT json_agg(i ORDER BY i.categorie_stock, i.article) FROM (
      SELECT DISTINCT ON (categorie_stock, article)
             categorie_stock, article, quantite
      FROM flux_logistique
      WHERE site_id = $1::uuid AND date_operation = $3::date
        AND type_flux = 'INVENTAIRE'
      ORDER BY categorie_stock, article, cree_le DESC, id DESC
    ) i
  ), '[]'::json) AS stock,

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
      WHERE site_id = $1::uuid
        AND ${local("debut")} < ($3::date + INTERVAL '1 day')
        AND COALESCE(${local("fin")}, ${local("debut")}) >= $3::date
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
             casse, manquant, vides, phn, description_faits, observations, mesures_prises
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

  // --- 1 - Agents groupés par poste depuis les pointages APS jour et nuit ---
  const pointages = { jour: new Map(), nuit: new Map() };
  const aliasPostesJour = {
    GARAGE: "EX GARAGE",
    PGIT: "PG2",
    FITAA: "FITAVA",
    EXTERIEUR: "PARKING EXTERIEUR",
  };
  for (const agent of d.agents) {
    if (!pointages[agent.service]) continue;
    const poste = agent.service === "jour" ? aliasPostesJour[agent.poste] || agent.poste : agent.poste;
    const parPoste = pointages[agent.service];
    if (!parPoste.has(poste)) parPoste.set(poste, []);
    const nomEmploye = [txt(agent.nom_employe), txt(agent.prenom_employe)].filter(Boolean).join(" ");
    parPoste.get(poste).push({
      nom: nomEmploye || txt(agent.prenom),
      matricule: txt(agent.matricule),
    });
  }
  const postesOrdre = [...new Set([...POSTES_JOUR, ...POSTES_NUIT].map(([poste]) => poste))];
  const agentsPostes = postesOrdre.map((poste) => {
    const jour = pointages.jour.get(poste) ?? [];
    const nuit = pointages.nuit.get(poste) ?? [];
    const effectifJour = POSTES_JOUR.find(([nom]) => nom === poste)?.[1] ?? 0;
    const effectifNuit = POSTES_NUIT.find(([nom]) => nom === poste)?.[1] ?? 0;
    const nombreLignes = Math.max(effectifJour, effectifNuit, jour.length, nuit.length, 1);
    return {
      poste,
      jour: Array.from({ length: nombreLignes }, (_, index) => jour[index] ?? { nom: "", matricule: "" }),
      nuit: Array.from({ length: nombreLignes }, (_, index) => nuit[index] ?? { nom: "", matricule: "" }),
    };
  });

  // --- 3, 4, 5 - Déchargements, chargements, stock extérieur ---
  const dechargements = [];
  const chargements = [];
  const stock = Object.fromEntries(Object.keys(ARTICLES_STOCK).map((k) => [k, 0]));
  for (const f of d.flux) {
    const detailsBouteilles = Array.isArray(f.details_bouteilles)
      ? f.details_bouteilles.map((b) => `${txt(b.designation)}: ${txt(b.quantite)}`).filter(Boolean).join(", ")
      : "";
    const ligne = {
      camion: txt(f.camion) || txt(f.immatriculation_vehicule) || txt(f.vehicule) || "-",
      transporteur: txt(f.transporteur) || txt(f.nom_chauffeur) || txt(f.chauffeur) || txt(f.proprietaire) || "-",
      titre: txt(f.numero_titre) || txt(f.document) || txt(f.titre) || txt(f.facture) || txt(f.numero_pesage) || "-",
      plomb: txt(f.plomb) || "-",
      heureDebut: txt(f.heure_arrivee) || txt(f.heure_pointe) || txt(f.heure_sortie) || "-",
      heureFin: txt(f.heure_sortie) || "-",
      comptage: txt(f.nbr) || txt(f.quantite_texte) || detailsBouteilles
        || [txt(f.designation), f.quantite == null ? "" : String(f.quantite), f.poids == null ? "" : `${f.poids} kg`].filter(Boolean).join(" : ")
        || "-",
      destination: txt(f.destinataire) || txt(f.provenance) || "-",
    };
    const type = norm(f.type_flux);
    if (DECHARGEMENT.test(type) || ["BOUTEILLES_VIDES", "MATIERE_PREMIERE", "DEPOTAGE_FUEL"].includes(type)) {
      dechargements.push(ligne);
    } else if (CHARGEMENT.test(type) || type === "DECHETS") {
      chargements.push(ligne);
    }
  }

  for (const f of d.stock) {
    const article = norm(f.article).replace(/[^A-Z0-9]/g, "");
    for (const [cle, code] of Object.entries(ARTICLES_STOCK)) {
      const categorieAttendue = ["cv12", "cv24", "cv20", "intercalaires"].includes(cle) ? "VIDES" : "PLEINS_EAUX";
      if (article.startsWith(code) && norm(f.categorie_stock) === categorieAttendue) {
        stock[cle] += Number(f.quantite) || 0;
      }
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
        txt(s.mesures_prises) && `Mesures : ${txt(s.mesures_prises)}`,
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
    agentsPostes,
    pointageApsJourEnregistre: d.pointage_aps_jour_enregistre,
    pointageApsNuitEnregistre: d.pointage_aps_nuit_enregistre,
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
