/** Fichiers acceptés en pièces jointes (documents d'un compte, fichiers d'une feuille de saisie) : extension → type MIME. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024

export const ALLOWED_FILE_TYPES = new Map([
  ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp'],
  ['pdf', 'application/pdf'], ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['csv', 'text/csv'], ['txt', 'text/plain'],
])

/** Nom et extension d'un fichier reçu dans l'en-tête `x-file-name` (encodé en URL) ; chaînes vides si invalide. */
export function readFileName(header) {
  let name
  try {
    name = decodeURIComponent(String(header || ''))
  } catch {
    name = ''
  }
  name = name.split(/[\/]/).pop().trim().slice(0, 240)
  return { name, extension: name.split('.').pop()?.toLowerCase() || '' }
}

/** Type MIME d'une image PNG, JPEG ou WebP, déduit du CONTENU (pas de l'en-tête envoyé). Le SVG est refusé : il peut contenir du script. Chaîne vide sinon. */
export function detectImageType(buffer) {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length > 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return ''
}
