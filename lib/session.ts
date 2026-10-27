/**
 * Sesi login aplikasi.
 *
 * Token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, SESSION_SECRET)).
 * Ditandatangani (bukan dienkripsi) sehingga tidak menyimpan password apa pun —
 * hanya kode anggota, peran, nama, dan masa berlaku.
 *
 * Semua kripto memakai Web Crypto (crypto.subtle) supaya bisa dipakai di
 * middleware Edge maupun di route handler Node, tanpa dependensi tambahan.
 */

export const SESSION_COOKIE = "alhaytham_session";

export type SessionRole = "staff" | "member";

export type Session = {
  /** Kode anggota, contoh: ADM-001 (petugas) atau AG-2024-001 (siswa). */
  code: string;
  role: SessionRole;
  name: string;
  /** Kedaluwarsa, unix detik. */
  exp: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 hari
export const REMEMBER_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 hari ("Ingat saya")

export function getSessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET?.trim();
  return secret || null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Buat token sesi untuk anggota yang baru berhasil login. */
export async function createSessionToken(
  session: Omit<Session, "exp">,
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const payload: Session = { ...session, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(encodedPayload),
  );
  return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Verifikasi token. Mengembalikan null bila rusak, dipalsukan, atau kedaluwarsa. */
export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<Session | null> {
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) return null;

  const signature = fromBase64Url(encodedSignature);
  if (!signature || signature.length !== 32) return null;

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature as BufferSource,
    encoder.encode(encodedPayload),
  );
  if (!valid) return null;

  const rawPayload = fromBase64Url(encodedPayload);
  if (!rawPayload) return null;

  try {
    const payload = JSON.parse(decoder.decode(rawPayload)) as Session;
    if (
      typeof payload?.code !== "string" ||
      !payload.code ||
      (payload.role !== "staff" && payload.role !== "member") ||
      typeof payload.exp !== "number" ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return { code: payload.code, role: payload.role, name: String(payload.name ?? ""), exp: payload.exp };
  } catch {
    return null;
  }
}

/** Ambil token dari header Cookie request. */
export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}

/** Baca sesi dari request (dipakai middleware dan route handler). */
export async function sessionFromRequest(req: Request): Promise<Session | null> {
  const secret = getSessionSecret();
  if (!secret) return null;
  const token = readSessionToken(req.headers.get("cookie"));
  if (!token) return null;
  return verifySessionToken(token, secret);
}

/** Header Set-Cookie untuk menyimpan sesi (httpOnly, SameSite=Lax). */
export function sessionCookie(token: string, remember = false): string {
  const maxAge = remember ? REMEMBER_TTL_SECONDS : DEFAULT_TTL_SECONDS;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

/** Header Set-Cookie untuk menghapus sesi (logout). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}
