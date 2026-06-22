const db = require('../config/db');

const getAuditEvents = async (req, res) => {
  try {
    const [accessLogs, logbook, consignes, vacations, extractions] = await Promise.all([
      db.query('SELECT id, name, badge, type, zone, time, detail FROM access_logs ORDER BY id DESC LIMIT 25'),
      db.query('SELECT id, date, time, category, zone, description, severity, agent FROM logbook_entries ORDER BY date DESC, time DESC LIMIT 25'),
      db.query('SELECT id, sender, text, priority, time, unread, target FROM consignes ORDER BY id DESC LIMIT 25'),
      db.query('SELECT id, date, shift, outgoing_agent, incoming_agent, summary, remarks, pending_items, signed_out, signed_in, status FROM vacations ORDER BY date DESC LIMIT 10'),
      db.query('SELECT id, camera_label, requested_by, requested_at, start_time, end_time, reason, status FROM camera_extractions ORDER BY requested_at DESC LIMIT 10'),
    ]);

    const events = [];

    accessLogs.rows.forEach((row) => {
      events.push({
        id: `AUD-ACC-${row.id}`,
        time: row.time,
        date: null,
        actor: row.name,
        action: `Accès ${row.type} badge ${row.badge} (${row.zone})`,
        level: row.type === 'refus' ? 'alert' : row.type === 'visiteur' ? 'warn' : 'info',
      });
    });

    logbook.rows.forEach((row) => {
      events.push({
        id: `AUD-LB-${row.id}`,
        time: row.time,
        date: row.date,
        actor: row.agent,
        action: `${row.category.toUpperCase()} - ${row.description}`,
        level: row.severity === 'critique' || row.severity === 'majeur' ? 'alert' : row.severity === 'mineur' ? 'warn' : 'info',
      });
    });

    consignes.rows.forEach((row) => {
      events.push({
        id: `AUD-C-${row.id}`,
        time: row.time,
        date: null,
        actor: row.sender,
        action: `Consigne ${row.priority.toUpperCase()} - ${row.text}`,
        level: row.unread ? 'warn' : 'info',
      });
    });

    vacations.rows.forEach((row) => {
      events.push({
        id: `AUD-V-${row.id}`,
        time: row.date,
        date: row.date,
        actor: `${row.outgoing_agent} -> ${row.incoming_agent}`,
        action: `Passation ${row.shift} - ${row.status}`,
        level: row.status === 'validee' ? 'info' : 'warn',
      });
    });

    extractions.rows.forEach((row) => {
      events.push({
        id: `AUD-X-${row.id}`,
        time: row.requested_at,
        date: null,
        actor: row.requested_by,
        action: `Extrait caméra ${row.camera_label} (${row.start_time} -> ${row.end_time})`,
        level: row.status === 'ready' ? 'info' : 'warn',
        sortAt: row.created_at,
      });
    });

    events.sort((a, b) => {
      const left = b.sortAt || `${b.date || ''} ${b.time}`;
      const right = a.sortAt || `${a.date || ''} ${a.time}`;
      return String(left).localeCompare(String(right));
    });

    return res.json(events.slice(0, 60));
  } catch (err) {
    console.error('Error fetching audit events:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération de l’audit.' });
  }
};

const getArchives = async (req, res) => {
  try {
    const vacationsResult = await db.query(
      'SELECT id, date, shift, outgoing_agent as outgoingAgent, incoming_agent as incomingAgent, summary, remarks, pending_items as pendingItems, signed_out as signedOut, signed_in as signedIn, status FROM vacations ORDER BY date DESC'
    );
    const logbookResult = await db.query(
      'SELECT date, COUNT(*) AS eventCount, SUM(CASE WHEN severity IN ("majeur", "critique") THEN 1 ELSE 0 END) AS incidentCount FROM logbook_entries GROUP BY date'
    );
    const accessResult = await db.query('SELECT COUNT(*) AS accessCount FROM access_logs');

    const logbookByDate = new Map(logbookResult.rows.map((row) => [row.date, row]));
    const accessCount = Number(accessResult.rows[0]?.accessCount || 0);

    const archives = vacationsResult.rows.map((row) => {
      const stats = logbookByDate.get(row.date) || { eventCount: 0, incidentCount: 0 };
      return {
        ...row,
        eventCount: Number(stats.eventCount || 0),
        incidentCount: Number(stats.incidentCount || 0),
        accessCount,
      };
    });

    return res.json(archives);
  } catch (err) {
    console.error('Error fetching archives:', err.message);
    return res.status(500).json({ error: 'Erreur lors de la récupération des archives.' });
  }
};

module.exports = {
  getAuditEvents,
  getArchives,
};
