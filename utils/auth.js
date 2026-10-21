import { createHmac, timingSafeEqual } from "node:crypto";

function signature(input, secret) {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function signAccessToken(user, secret) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: user.id, iat: now, exp: now + 8 * 60 * 60 })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${signature(unsigned, secret)}`;
}

export function verifyAccessToken(token, secret) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(signature(unsigned, secret));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number" || payload.exp <= Date.now() / 1000) return null;
    return { id: payload.sub };
  } catch {
    return null;
  }
}

export function getRequestUser(request, secret) {
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? verifyAccessToken(match[1], secret) : null;
}