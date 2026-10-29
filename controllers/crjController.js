
// ---------------------------------------------------------------------------
// Réglages à adapter si besoin
// ---------------------------------------------------------------------------
const TZ = "Indian/Antananarivo";

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
const aujourdhui = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

// Colonne "timestamp sans fuseau" (écrite en UTC par le serveur) -> heure locale
const local = (col) => `((${col} AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')`;

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
      'nom', a.agent->>'nom',
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
  COALESCE((
    SELECT json_agg(json_build_object('service', c.service, 'postes', c.postes) ORDER BY c.source_order)
    FROM (
      SELECT 'jour' AS service, data AS postes, 1 AS source_order
      FROM pointage_aps_jour
      WHERE site_id = $1::uuid AND date_pointage = $3::date
      UNION ALL
      SELECT 'nuit' AS service, data AS postes, 1 AS source_order
      FROM pointage_aps_nuit
      WHERE site_id = $1::uuid AND date_pointage = $3::date
      UNION ALL
      SELECT service, postes, 0 AS source_order
      FROM configuration_postes_aps
      WHERE site_id = $1::uuid
    ) c
  ), '[]'::json) AS configured_postes,
  EXISTS (
    SELECT 1 FROM pointage_aps_jour pa
    WHERE pa.site_id = $1::uuid AND pa.date_pointage = $3::date
  ) AS pointage_aps_jour_enregistre,
  EXISTS (
    SELECT 1 FROM pointage_aps_nuit pa
    WHERE pa.site_id = $1::uuid AND pa.date_pointage = $3::date
  ) AS pointage_aps_nuit_enregistre,

  -- 2 - Clés : reprend les mêmes champs que le registre Mouvements clés
  COALESCE((
    SELECT json_agg(json_build_object(
      'date', k.date_suivi,
      'personne', k.personne,
      'matricule', k.matricule,
      'heureSortie', k.heure_sortie,
      'typeCle', k.type_cle,
      'nombreCles', k.nombre_cles,
      'heureRetour', k.heure_retour,
      'lieu', k.lieu
    ) ORDER BY k.heure_sortie NULLS LAST, k.created_at)
    FROM (
      SELECT sc.id, sc.date_suivi,
             COALESCE(
               NULLIF(TRIM(CONCAT_WS(' ', NULLIF(sc.nom_personne, ''), NULLIF(sc.prenom_personne, ''))), ''),
               sc.personne_habilitee,
               ''
             ) AS personne,
             COALESCE(sc.matricule_personne, '') AS matricule,
             COALESCE(
               to_char(sc.heure_sortie, 'HH24:MI'),
               NULLIF(sc.heure, ''),
               ''
             ) AS heure_sortie,
             COALESCE(NULLIF(sc.type_cle, ''), NULLIF(sc.trousse_cle, ''), '') AS type_cle,
             COALESCE(sc.nombre_cles, 1) AS nombre_cles,
             COALESCE(
               to_char(sc.heure_retour, 'HH24:MI'),
               r.heure,
               ''
             ) AS heure_retour,
             COALESCE(sc.lieu, '') AS lieu,
             COALESCE(sc.cree_le, sc.created_at) AS created_at
      FROM suivi_cle sc
      LEFT JOIN LATERAL (
        SELECT r1.personne_habilitee, r1.heure, r1.created_at
        FROM suivi_cle r1
        WHERE r1.action = 'Réintégration' AND r1.perception_id = sc.id
        ORDER BY r1.created_at
        LIMIT 1
      ) r ON true
      WHERE sc.site_id = $1::uuid
        AND sc.date_suivi = $3::date
        AND (sc.action = 'Perception' OR sc.type_cle IS NOT NULL)
    ) k
  ), '[]'::json) AS cles,

  -- 3, 4, 5 - Flux logistiques
  COALESCE((
    SELECT json_agg(f ORDER BY f.cree_le) FROM (
      SELECT type_flux, type_chargement, camion, immatriculation_vehicule, vehicule, transporteur,
             nom_chauffeur, chauffeur, magasinier, cree, proprietaire,
             document, facture, numero_titre, titre, plomb, lp,
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
      SELECT to_char(c.heure, 'HH24:MI') AS heure, c.personne, c.appartenance,
             c.demandeur, c.resultat
      FROM controle_alcoolemie c
      WHERE c.site_id = $1::uuid AND c.date_controle = $3::date
    ) a
  ), '[]'::json) AS alcootests,

  -- Rondes
  COALESCE((
    SELECT json_agg(r ORDER BY r.debut) FROM (
      SELECT r.observations,
             to_char(${local("r.debut")}, 'HH24:MI') AS debut,
             to_char(${local("r.fin")}, 'HH24:MI') AS fin
      FROM ronde r
      WHERE r.site_id = $1::uuid
        AND ${local("r.debut")} < ($3::date + INTERVAL '1 day')
        AND COALESCE(${local("r.fin")}, ${local("r.debut")}) >= $3::date
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
  const effectifs = { jour: new Map(), nuit: new Map() };
  const ordrePostes = [];
  const aliasPostesJour = {
    GARAGE: "EX GARAGE",
    PGIT: "PG2",
    FITAA: "FITAVA",
    EXTERIEUR: "PARKING EXTERIEUR",
  };
  for (const configuration of d.configured_postes ?? []) {
    const service = configuration.service;
    if (!effectifs[service] || !configuration.postes || typeof configuration.postes !== "object") continue;
    const entries = Array.isArray(configuration.postes)
      ? configuration.postes
        .filter((poste) => poste && typeof poste.name === "string")
        .map((poste) => [poste.name, Number(poste.count)] )
      : Object.entries(configuration.postes)
        .filter(([, agents]) => Array.isArray(agents))
        .map(([name, agents]) => [name, agents.length]);
    for (const [savedName, count] of entries) {
      if (!Number.isInteger(count) || count < 1 || count > 30) continue;
      const name = service === "jour" ? aliasPostesJour[savedName] || savedName : savedName;
      effectifs[service].set(name, count);
      if (!ordrePostes.includes(name)) ordrePostes.push(name);
    }
  }
  for (const agent of d.agents) {
    if (!pointages[agent.service]) continue;
    const poste = agent.service === "jour" ? aliasPostesJour[agent.poste] || agent.poste : agent.poste;
    const parPoste = pointages[agent.service];
    if (!parPoste.has(poste)) parPoste.set(poste, []);
    const nomEmploye = [txt(agent.nom_employe), txt(agent.prenom_employe)].filter(Boolean).join(" ");
    parPoste.get(poste).push({
      nom: nomEmploye || txt(agent.nom) || txt(agent.prenom),
      matricule: txt(agent.matricule),
    });
    if (!ordrePostes.includes(poste)) ordrePostes.push(poste);
  }
  const postesOrdre = [...new Set([...ordrePostes, ...pointages.jour.keys(), ...pointages.nuit.keys()])];
  const agentsPostes = postesOrdre.map((poste) => {
    const jour = pointages.jour.get(poste) ?? [];
    const nuit = pointages.nuit.get(poste) ?? [];
    const nombreLignes = Math.max(
      effectifs.jour.get(poste) ?? 0,
      effectifs.nuit.get(poste) ?? 0,
      jour.length,
      nuit.length,
      1,
    );
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
    const type = norm(f.type_flux);
    if (type === "BOUTEILLES_VIDES") {
      dechargements.push({
        camion: txt(f.immatriculation_vehicule) || txt(f.vehicule) || txt(f.camion) || "-",
        transporteur: txt(f.nom_chauffeur) || txt(f.transporteur) || txt(f.chauffeur) || "-",
        titre: txt(f.numero_titre) || "-",
        plomb: txt(f.plomb) || "-",
        heureDebut: txt(f.heure_arrivee) || "-",
        heureFin: txt(f.heure_sortie) || "-",
        comptage: Array.isArray(f.details_bouteilles)
          ? f.details_bouteilles.map((b) => `${txt(b.designation)}: ${txt(b.quantite)}`).filter(Boolean).join(", ") || "-"
          : "-",
        provenance: txt(f.provenance) || "-",
      });
      continue;
    }

    if (type === "CHARGEMENT" && ["STAR", "PARTICULIER"].includes(norm(f.type_chargement))) {
      const chargementDetails = [
        txt(f.designation),
        txt(f.quantite_texte),
        f.poids == null ? "" : `${f.poids} kg`,
      ].filter(Boolean).join(" · ");
      chargements.push({
        camion: txt(f.camion) || "-",
        transporteur: [
          norm(f.type_chargement) === "STAR" ? "STAR" : "PARTICULIER",
          txt(f.proprietaire),
          txt(f.nom_chauffeur),
        ].filter(Boolean).join(" · "),
        titre: [txt(f.lp) ? `LP ${txt(f.lp)}` : "", txt(f.titre) ? `N° ${txt(f.titre)}` : ""].filter(Boolean).join(" · ") || "-",
        plomb: txt(f.plomb) || "-",
        heureDebut: txt(f.heure_arrivee) || "-",
        heureFin: txt(f.heure_sortie) || "-",
        comptage: chargementDetails || "-",
        provenance: txt(f.provenance) || "-",
        destination: txt(f.destinataire) || "-",
      });
      continue;
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
  }));

  // --- Rondes ---
  const rondes = d.rondes.map((r) => ({
    debut: r.debut || "-",
    fin: r.fin || "-",
    obs: txt(r.observations) || "-",
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
    cles: d.cles ?? [],
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
