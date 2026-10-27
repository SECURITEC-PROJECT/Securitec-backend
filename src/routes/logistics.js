import { apiPrefix, getPool, getOrCreateSite, json, readJson, requestUser, text } from "../server-support.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const categories = new Set(["VIDES", "PLEINS_EAUX"]);
const incidentTypes = new Set(["ANOMALIE", "VIOLATION_PROCEDURE"]);

export async function handleLogistics(request, response, pathname) {
  const account = requestUser(request, response);
  if (!account) return;
  let pool;
  try { pool = await getPool(); }
  catch (error) { json(response, 503, { error: error.message || "Base de données inaccessible." }); return; }
  const incidentPath = `${apiPrefix}/logistics/incidents`;
  if (pathname === incidentPath) {
    try {
      if (request.method === "GET") {
        const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
        const requestedSite = account.siteId || url.searchParams.get("siteId") || null;
        const type = url.searchParams.get("type");
        const result = await pool.query(
          `SELECT e.id, e.date_operation AS date, to_char(e.heure,'HH24:MI') AS time,
                  e.type_signalement AS type, e.camion, e.transporteur, e.document,
                  e.casse AS broken, e.manquant AS missing, e.vides AS empty, e.phn,
                  e.description_faits AS facts, e.personne AS person, e.observations, e.mesures_prises AS measures,
                  s.nom AS "siteName", s.type_site AS "siteType", e.cree_le AS "createdAt"
           FROM signalement_logistique e JOIN site s ON s.id=e.site_id
           WHERE ($1::uuid IS NULL OR e.site_id=$1::uuid) AND ($2::varchar IS NULL OR e.type_signalement=$2::varchar)
           ORDER BY e.date_operation DESC,e.heure DESC,e.cree_le DESC LIMIT 1000`,
          [requestedSite, incidentTypes.has(type) ? type : null],
        );
        json(response,200,{entries:result.rows}); return;
      }
      if (request.method !== "POST") { json(response,405,{error:"Méthode non autorisée."}); return; }
      const body = await readJson(request);
      const type = incidentTypes.has(body.type) ? body.type : "";
      const date = text(body.date,10), time = text(body.time,5);
      if (!type || !datePattern.test(date) || !timePattern.test(time)) {
        json(response,400,{error:"Choisissez une rubrique et indiquez une date et une heure valides."}); return;
      }
      const values = {
        camion:text(body.camion,160) || null, transporteur:text(body.transporteur) || null, document:text(body.document,160) || null,
        broken:text(body.broken,2000) || null, missing:text(body.missing,2000) || null, empty:text(body.empty,2000) || null,
        phn:text(body.phn,2000) || null, facts:text(body.facts,20000) || null, person:text(body.person,255) || null,
        observations:text(body.observations,20000) || null, measures:text(body.measures,20000) || null,
      };
      if (type === "ANOMALIE" && !values.facts) { json(response,400,{error:"Décrivez les faits de l’anomalie."}); return; }
      if (type === "VIOLATION_PROCEDURE" && (!values.person || !values.observations)) { json(response,400,{error:"Indiquez le nom de la personne et les observations."}); return; }
      const client=await pool.connect();
      try {
        await client.query("BEGIN");
        const siteId=account.siteId || await getOrCreateSite(client,body.siteName,body.siteType);
        const siteResult=await client.query("SELECT nom,type_site FROM site WHERE id=$1",[siteId]);
        const site=siteResult.rows[0];
        if(!site) throw Object.assign(new Error("Site de travail introuvable."),{status:404});
        const inserted=await client.query(
          `INSERT INTO signalement_logistique (date_operation,heure,type_signalement,camion,transporteur,document,casse,manquant,vides,phn,description_faits,personne,observations,mesures_prises,site_id,utilisateur_id)
           VALUES ($1,$2::time,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           RETURNING id,cree_le AS "createdAt"`,
          [date,time,type,values.camion,values.transporteur,values.document,values.broken,values.missing,values.empty,values.phn,values.facts,values.person,values.observations,values.measures,siteId,account.sub],
        );
        await client.query("COMMIT");
        json(response,201,{entry:{id:inserted.rows[0].id,date,time,type,...values,siteName:site.nom,siteType:site.type_site,createdAt:inserted.rows[0].createdAt}}); return;
      } catch(error) { await client.query("ROLLBACK").catch(()=>{}); json(response,error.status||500,{error:error.message||"Enregistrement du signalement impossible."}); return; }
      finally { client.release(); }
    } catch(error) { json(response,error.status||500,{error:error.message||"Opération sur les signalements impossible."}); return; }
  }
  if (pathname !== `${apiPrefix}/logistics`) { json(response, 404, { error: "Route logistique introuvable." }); return; }
  try {
    if (request.method === "GET") {
      const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const siteId = account.siteId || url.searchParams.get("siteId") || null;
      const result = await pool.query(
        `SELECT f.id, f.date_operation AS date, f.type_flux AS type, f.camion, f.transporteur, f.document, f.plomb,
          to_char(f.heure_sortie,'HH24:MI') AS "heureSortie", f.numero_pesage AS "numeroPesage",
          f.facture, f.poids, f.destinataire, f.vehicule, f.categorie_stock AS "categorieStock", f.article, f.quantite,
          s.nom AS "siteName", s.type_site AS "siteType",
          f.cree_le AS "createdAt"
         FROM flux_logistique f JOIN site s ON s.id=f.site_id
         WHERE ($1::uuid IS NULL OR f.site_id=$1::uuid)
         ORDER BY f.date_operation DESC, f.cree_le DESC LIMIT 1000`, [siteId]);
      json(response, 200, { entries: result.rows }); return;
    }
    if (request.method !== "POST") { json(response, 405, { error: "Méthode non autorisée." }); return; }
    const body = await readJson(request);
    const type = ["DECHARGEMENT", "CHARGEMENT", "INVENTAIRE", "DECHETS"].includes(body.type) ? body.type : "";
    const date = text(body.date, 10);
    if (!type || !datePattern.test(date)) { json(response, 400, { error: "Choisissez le type de flux et une date valide." }); return; }
    if (type === "DECHETS") {
      const time = text(body.heureSortie, 5);
      const numeroPesage = text(body.numeroPesage, 100);
      const facture = text(body.facture, 160);
      const poids = Number(body.poids);
      const destinataire = text(body.destinataire, 255);
      const vehicule = text(body.vehicule, 160);
      if (!timePattern.test(time) || !numeroPesage || !facture || !Number.isFinite(poids) || poids <= 0 || poids > 9999999999.99 || !destinataire || !vehicule) {
        json(response, 400, { error: "Renseignez une heure de sortie, un numéro de pesage, une facture, un poids positif, le destinataire et le véhicule." });
        return;
      }
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const siteId = account.siteId || await getOrCreateSite(client, body.siteName, body.siteType);
        const siteResult = await client.query("SELECT nom, type_site FROM site WHERE id=$1", [siteId]);
        const site = siteResult.rows[0];
        if (!site) throw Object.assign(new Error("Site de travail introuvable."), { status: 404 });
        const inserted = await client.query(
          `INSERT INTO flux_logistique (date_operation, type_flux, heure_sortie, numero_pesage, facture, poids, destinataire, vehicule, site_id, utilisateur_id)
           VALUES ($1,'DECHETS',$2::time,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id, cree_le AS "createdAt"`,
          [date, time, numeroPesage, facture, poids, destinataire, vehicule, siteId, account.sub],
        );
        await client.query("COMMIT");
        json(response, 201, { entry: {
          ...inserted.rows[0], date, type, heureSortie: time, numeroPesage, facture, poids, destinataire, vehicule,
          siteName: site.nom, siteType: site.type_site,
        } });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        json(response, error.status || 500, { error: error.message || "Enregistrement de la sortie de déchets impossible." });
      } finally {
        client.release();
      }
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const siteId = account.siteId || await getOrCreateSite(client, body.siteName, body.siteType);
      const siteResult = await client.query("SELECT nom, type_site FROM site WHERE id=$1", [siteId]);
      const site = siteResult.rows[0];
      if (!site) throw Object.assign(new Error("Site de travail introuvable."), { status: 404 });
      if (type === "INVENTAIRE") {
        if (site.type_site !== "AGENCE") throw Object.assign(new Error("L’inventaire du stock est prévu pour le modèle Agence, conformément à la rubrique 5 du compte rendu."), { status: 400 });
        const category = categories.has(body.categorieStock) ? body.categorieStock : "";
        const items = Array.isArray(body.items) ? body.items.slice(0, 50).filter((item) => item?.quantite !== "" && item?.quantite != null) : [];
        if (!category || items.length === 0) throw Object.assign(new Error("Choisissez la catégorie de stock et renseignez au moins une quantité."), { status: 400 });
        const created = [];
        for (const item of items) {
          const article = text(item?.article, 100);
          const quantity = item?.quantite === "" || item?.quantite == null ? null : Number(item.quantite);
          if (!article || quantity === null || !Number.isFinite(quantity) || quantity < 0 || quantity > 9999999999.99) {
            throw Object.assign(new Error("Chaque article doit avoir une quantité valide, égale ou supérieure à zéro."), { status: 400 });
          }
          const inserted = await client.query(
            `INSERT INTO flux_logistique (date_operation, type_flux, categorie_stock, article, quantite, site_id, utilisateur_id)
             VALUES ($1,'INVENTAIRE',$2,$3,$4,$5,$6) RETURNING id, cree_le AS "createdAt"`,
            [date, category, article, quantity, siteId, account.sub]);
          created.push({ ...inserted.rows[0], date, type, categorieStock: category, article, quantite: quantity, siteName: site.nom, siteType: site.type_site });
        }
        await client.query("COMMIT"); json(response, 201, { entries: created }); return;
      }
      const camion = text(body.camion, 160);
      if (!camion) throw Object.assign(new Error("Le numéro du camion et de la remorque est obligatoire."), { status: 400 });
      const inserted = await client.query(
        `INSERT INTO flux_logistique (date_operation, type_flux, camion, transporteur, document, plomb, site_id, utilisateur_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, cree_le AS "createdAt"`,
        [date, type, camion, text(body.transporteur) || null, text(body.document, 160) || null, text(body.plomb, 100) || null, siteId, account.sub]);
      await client.query("COMMIT");
      json(response, 201, { entry: { ...inserted.rows[0], date, type, camion, transporteur: text(body.transporteur), document: text(body.document, 160), plomb: text(body.plomb, 100), siteName: site.nom, siteType: site.type_site } });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      json(response, error.status || 500, { error: error.message || "Enregistrement du flux logistique impossible." });
    } finally { client.release(); }
  } catch (error) { json(response, error.status || 500, { error: error.message || "Opération logistique impossible." }); }
}
