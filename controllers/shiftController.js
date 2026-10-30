import { randomUUID } from "node:crypto";

// Récupérer toutes les prises de poste (table au singulier 'prise_de_poste')
export async function getShifts(request, response, pool, siteId = null) {
  try {
    const query = `
      SELECT p.id, p.matricule, p.nom, p.prenom, p.prestataire, p.site_de_travail,
             p.notes, p.started_at, p.ended_at, p.poste_id AS "posteId",
             p.shift_type AS "shiftType", p.fonction_service AS "fonctionService",
             COALESCE(sp.id, p.service_id, p.id) AS "serviceId", po.nom AS "posteNom",
             COALESCE(sp.site_id, s.id) AS "siteId",
             sp.started_at AS "serviceStartedAt", sp.ended_at AS "serviceEndedAt",
             sp.notes AS "serviceNotes"
      FROM prise_de_poste p
      LEFT JOIN service_poste sp ON sp.id=COALESCE(p.service_id,p.id)
      LEFT JOIN site s ON LOWER(BTRIM(s.nom))=LOWER(BTRIM(p.site_de_travail))
      LEFT JOIN poste po ON po.id=p.poste_id
      WHERE ($1::uuid IS NULL OR s.id=$1::uuid)
      ORDER BY p.started_at DESC;
    `;
    const result = await pool.query(query, [siteId]);
    return result.rows;
  } catch (error) {
    console.error("Erreur GET /shifts:", error);
    throw error;
  }
}

export async function getShiftPosts(pool, siteId) {
  const result = await pool.query(
    `SELECT id, nom FROM poste WHERE site_id=$1::uuid AND actif=true ORDER BY
       CASE WHEN nom='PG Principal' THEN 0 WHEN nom ~ '^PG[2-6]$' THEN CAST(SUBSTRING(nom FROM 3) AS INTEGER) ELSE 7 END,
       nom`,
    [siteId],
  );
  return result.rows;
}

async function createGroupedShift(data, pool, userId) {
  const siteId = typeof data.siteId === "string" ? data.siteId : "";
  const posteId = typeof data.posteId === "string" ? data.posteId : "";
  const shiftType = typeof data.shiftType === "string" ? data.shiftType.toUpperCase() : "";
  const chefMatricule = typeof data.chefMatricule === "string" ? data.chefMatricule.trim() : "";
  const matricules = Array.isArray(data.agentMatricules) ? data.agentMatricules : [];
  if (!siteId || !posteId || !["JOUR", "NUIT"].includes(shiftType) || !chefMatricule || matricules.length > 29) {
    throw Object.assign(new Error("Le site, le poste, le service jour/nuit et le chef de poste sont obligatoires."), { status: 400 });
  }
  const crewMatricules = [chefMatricule, ...matricules.map((value) => typeof value === "string" ? value.trim() : "")];
  const normalized = crewMatricules.map((value) => value.toLocaleUpperCase("fr"));
  if (normalized.some((value) => !value) || new Set(normalized).size !== normalized.length) {
    throw Object.assign(new Error("Chaque agent doit avoir un matricule unique."), { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const post = await client.query(
      `SELECT p.id, p.nom, p.site_id AS "siteId", s.nom AS "siteName"
       FROM poste p JOIN site s ON s.id=p.site_id
       WHERE p.id=$1::uuid AND p.site_id=$2::uuid AND p.actif=true AND s.actif=true
       FOR SHARE OF p`,
      [posteId, siteId],
    );
    if (!post.rows[0]) throw Object.assign(new Error("Le poste sélectionné n’appartient pas à ce site ou est inactif."), { status: 400 });

    if (data.replacesServiceId) {
      const outgoing = await client.query(
        `SELECT COALESCE(service_id,id) AS id, poste_id AS "posteId", shift_type AS "shiftType"
         FROM prise_de_poste WHERE id=$1::uuid OR service_id=$1::uuid
         ORDER BY CASE WHEN fonction_service='CHEF' THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE`,
        [data.replacesServiceId],
      );
      if (!outgoing.rows[0] || outgoing.rows[0].posteId !== posteId || outgoing.rows[0].shiftType !== shiftType) {
        throw Object.assign(new Error("Le service sortant ne correspond pas au poste et au type de service sélectionnés."), { status: 409 });
      }
      await client.query(
        `UPDATE prise_de_poste SET ended_at=NOW()
         WHERE (id=$1::uuid OR service_id=$1::uuid) AND ended_at IS NULL`,
        [outgoing.rows[0].id],
      );
      await client.query(`UPDATE service_poste SET ended_at=NOW() WHERE id=$1::uuid AND ended_at IS NULL`, [outgoing.rows[0].id]);
    }

    const employees = await client.query(
      `SELECT e.id, e.matricule, e.nom, e.prenom, pr.nom AS prestataire
       FROM employe e JOIN prestataire pr ON pr.id=e.prestataire_id
       WHERE e.site_id=$1::uuid AND e.actif=true AND pr.actif=true
         AND UPPER(BTRIM(e.matricule)) = ANY($2::text[])
       ORDER BY array_position($2::text[], UPPER(BTRIM(e.matricule)))
       FOR SHARE OF e`,
      [siteId, normalized],
    );
    if (employees.rows.length !== crewMatricules.length) {
      throw Object.assign(new Error("Un ou plusieurs matricules ne correspondent pas à des agents actifs de ce site."), { status: 400 });
    }
    const employeeByMatricule = new Map(employees.rows.map((employee) => [employee.matricule.trim().toLocaleUpperCase("fr"), employee]));
    const crew = normalized.map((matricule) => employeeByMatricule.get(matricule));
    const leader = crew[0];

    const existing = await client.query(
      `SELECT 1 FROM service_poste
       WHERE poste_id=$1::uuid AND shift_type=$2::shift_agent AND ended_at IS NULL LIMIT 1 FOR UPDATE`,
      [posteId, shiftType],
    );
    if (existing.rows[0]) {
      throw Object.assign(new Error(`Une prise de poste ${shiftType.toLowerCase()} est déjà ouverte pour ${post.rows[0].nom}.`), { status: 409 });
    }

    const serviceId = randomUUID();
    const serviceNotes = typeof data.notes === "string" ? data.notes.trim().slice(0, 5000) : "";
    await client.query(
      `INSERT INTO service_poste (id,site_id,poste_id,shift_type,started_at,ouvert_par,notes)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::shift_agent,NOW(),$5::uuid,$6)`,
      [serviceId, siteId, posteId, shiftType, userId, serviceNotes],
    );
    const leaderResult = await client.query(
      `INSERT INTO prise_de_poste
         (matricule,nom,prenom,prestataire,site_de_travail,notes,started_at,poste_id,service_id,shift_type,fonction_service,ouvert_par)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7::uuid,$8::uuid,$9::shift_agent,'CHEF',$10::uuid)
       RETURNING id,matricule,nom,prenom,prestataire,site_de_travail,notes,started_at,ended_at,
                 poste_id AS "posteId", shift_type AS "shiftType", fonction_service AS "fonctionService"`,
      [leader.matricule, leader.nom, leader.prenom, leader.prestataire, post.rows[0].siteName,
        serviceNotes, posteId, serviceId, shiftType, userId],
    );
    const shifts = [leaderResult.rows[0]];
    for (const employee of crew.slice(1)) {
      const result = await client.query(
        `INSERT INTO prise_de_poste
           (matricule,nom,prenom,prestataire,site_de_travail,notes,started_at,poste_id,service_id,shift_type,fonction_service,ouvert_par)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::uuid,$9::uuid,$10::shift_agent,'AGENT',$11::uuid)
         RETURNING id,matricule,nom,prenom,prestataire,site_de_travail,notes,started_at,ended_at,
                   poste_id AS "posteId", shift_type AS "shiftType", fonction_service AS "fonctionService"`,
        [employee.matricule, employee.nom, employee.prenom, employee.prestataire, post.rows[0].siteName,
          serviceNotes, leaderResult.rows[0].started_at,
          posteId, serviceId, shiftType, userId],
      );
      shifts.push(result.rows[0]);
    }
    await client.query("COMMIT");
    return { serviceId, posteId, posteNom: post.rows[0].nom, shiftType, shifts: shifts.map((shift) => ({ ...shift, serviceId, posteId, posteNom: post.rows[0].nom, siteId: post.rows[0].siteId })) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") throw Object.assign(new Error("Une prise de poste est déjà ouverte pour ce poste et ce service."), { status: 409 });
    throw error;
  } finally {
    client.release();
  }
}

// Créer une nouvelle prise de poste
export async function createShift(data, pool, userId) {
  if (data?.posteId && data?.shiftType && data?.chefMatricule) {
    return createGroupedShift(data, pool, userId);
  }
  const { matricule, nom, prenom, prestataire, site_de_travail, notes } = data;

  if (!matricule || !nom || !prenom) {
    throw new Error("Le matricule, le nom et le prénom sont obligatoires.");
  }

  const serviceId = randomUUID();
  const values = [
    matricule,
    nom,
    prenom,
    prestataire || "securitec",
    site_de_travail || "Usine Antsirabe",
    notes || ""
  ];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const site = await client.query(`SELECT id FROM site WHERE LOWER(BTRIM(nom))=LOWER(BTRIM($1)) LIMIT 1`, [values[4]]);
    await client.query(
      `INSERT INTO service_poste (id,site_id,started_at,ouvert_par,notes) VALUES ($1::uuid,$2::uuid,NOW(),$3::uuid,$4)`,
      [serviceId, site.rows[0]?.id || null, userId || null, values[5]],
    );
    const result = await client.query(
      `INSERT INTO prise_de_poste (matricule,nom,prenom,prestataire,site_de_travail,notes,started_at,service_id,fonction_service,ouvert_par)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7::uuid,'CHEF',$8::uuid) RETURNING *`,
      [...values, serviceId, userId || null],
    );
    await client.query("COMMIT");
    return { ...result.rows[0], serviceId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// Clôturer une prise de poste
export async function endShift(shiftId, pool, siteId = null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const service = await client.query(
      `SELECT sp.id FROM service_poste sp
       LEFT JOIN prise_de_poste p ON p.service_id=sp.id
       WHERE (sp.id=$1::uuid OR p.id=$1::uuid)
         AND ($2::uuid IS NULL OR sp.site_id=$2::uuid OR p.site_de_travail IN (SELECT nom FROM site WHERE id=$2::uuid))
       LIMIT 1 FOR UPDATE OF sp`,
      [shiftId, siteId],
    );
    if (!service.rows[0]) { await client.query("ROLLBACK"); return null; }
    const serviceId = service.rows[0].id;
    const closedAt = new Date();
    const result = await client.query(
      `UPDATE prise_de_poste SET ended_at=COALESCE(ended_at,NOW())
       WHERE service_id=$1::uuid RETURNING *`, [serviceId],
    );
    await client.query(`UPDATE service_poste SET ended_at=COALESCE(ended_at,NOW()) WHERE id=$1::uuid`, [serviceId]);
    await client.query("COMMIT");
    if (!result.rows.length) return { id: serviceId, ended_at: closedAt };
    return result.rows.find((row) => row.fonction_service === "CHEF") || result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
