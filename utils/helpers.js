
export function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

export async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4096) throw Object.assign(new Error("Requête trop volumineuse"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Corps JSON invalide"), { status: 400 });
  }
}

export function logNetworkCauses(error) {
  const pending = [error.sourceError || error.cause].filter(Boolean);
  const seen = new Set();
  while (pending.length) {
    const current = pending.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    console.error("Cause réseau:", current.code || current.name || "erreur", current.message || "");
    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors);
  }
}