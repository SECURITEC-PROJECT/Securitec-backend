/** Erreur métier renvoyée telle quelle au client. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function notFound(_req, res) {
  res.status(404).json({ error: 'Route introuvable.' })
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(error, _req, res, _next) {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message, ...(error.required && { required: error.required }) })
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Corps de requête invalide.' })
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Le fichier est trop volumineux.' })
  if (error.code === 'P2002') return res.status(409).json({ error: 'Cet enregistrement existe déjà.' })
  console.error('Erreur non gérée :', error.code || error.name, error.message)
  res.status(500).json({ error: 'Erreur interne du serveur.' })
}
