/**
 * Minimal Google Drive client backed by OAuth2 user credentials.
 *
 * Uses the user's own Google account (via refresh token) so files count
 * against the user's Drive quota — no service-account quota limitations.
 *
 * Files are stored flat inside a single Drive folder. Each logical file id
 * (e.g. "book-cover:ABC", "ebook:XYZ", "member-avatar:001", "profile-avatar")
 * is sanitized into a unique Drive file name, so lookups are deterministic and
 * stateless (safe for Vercel serverless functions).
 *
 * Env vars needed:
 *   GOOGLE_DRIVE_CLIENT_ID      – OAuth2 client ID
 *   GOOGLE_DRIVE_CLIENT_SECRET  – OAuth2 client secret
 *   GOOGLE_DRIVE_REFRESH_TOKEN  – OAuth2 refresh token (from setup flow)
 *   GOOGLE_DRIVE_FOLDER_ID      – Drive folder to store files in
 */

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function getOAuthConfig() {
  const clientId = env("GOOGLE_DRIVE_CLIENT_ID");
  const clientSecret = env("GOOGLE_DRIVE_CLIENT_SECRET");
  const refreshToken = env("GOOGLE_DRIVE_REFRESH_TOKEN");
  const folderId = env("GOOGLE_DRIVE_FOLDER_ID");
  if (!clientId || !clientSecret || !refreshToken || !folderId) return null;
  return { clientId, clientSecret, refreshToken, folderId };
}

export function isDriveConfigured(): boolean {
  return getOAuthConfig() !== null;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(cfg: NonNullable<ReturnType<typeof getOAuthConfig>>): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google OAuth refresh gagal (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  if (!data.access_token) throw new Error("Google OAuth tidak mengembalikan access token");

  cachedToken = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

/** Convert a logical file id into a safe, unique Drive file name. */
export function driveFileName(logicalId: string): string {
  return logicalId.replace(/[\\/:*?"<>|]/g, "_");
}

type DriveFile = { id: string; name: string; mimeType: string };

async function findFile(name: string, cfg: NonNullable<ReturnType<typeof getOAuthConfig>>, token: string): Promise<DriveFile | null> {
  const query = `name='${name.replace(/'/g, "\\'")}' and '${cfg.folderId}' in parents and trashed=false`;
  const res = await fetch(
    `${DRIVE_API}?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google Drive list gagal (${res.status}): ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { files?: DriveFile[] };
  return data.files?.[0] ?? null;
}

function multipartBody(metadata: object, media: Buffer, mimeType: string, boundary: string) {
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`,
    "utf8"
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return Buffer.concat([head, media, tail]);
}

/** Create or replace the file for a logical id inside the configured folder. */
export async function uploadDriveFile(
  logicalId: string,
  media: Buffer,
  mimeType: string
): Promise<void> {
  const cfg = getOAuthConfig();
  if (!cfg) throw new Error("Google Drive belum dikonfigurasi (GOOGLE_DRIVE_*).");
  const token = await getAccessToken(cfg);
  const name = driveFileName(logicalId);
  const existing = await findFile(name, cfg, token);

  const boundary = `alhaytham_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata: Record<string, unknown> = { name, mimeType: mimeType || "application/octet-stream" };
  if (!existing) metadata.parents = [cfg.folderId];

  const res = await fetch(
    existing
      ? `${DRIVE_UPLOAD}/${existing.id}?uploadType=multipart`
      : `${DRIVE_UPLOAD}?uploadType=multipart`,
    {
      method: existing ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody(metadata, media, mimeType || "application/octet-stream", boundary) as BodyInit,
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google Drive upload gagal (${res.status}): ${detail.slice(0, 300)}`);
  }
}

/** Download a file by logical id. Returns { data, mimeType } or null if absent. */
export async function downloadDriveFile(
  logicalId: string
): Promise<{ data: Buffer; mimeType: string } | null> {
  const cfg = getOAuthConfig();
  if (!cfg) throw new Error("Google Drive belum dikonfigurasi (GOOGLE_DRIVE_*).");
  const token = await getAccessToken(cfg);
  const existing = await findFile(driveFileName(logicalId), cfg, token);
  if (!existing) return null;

  const res = await fetch(`${DRIVE_API}/${existing.id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google Drive download gagal (${res.status}): ${detail.slice(0, 300)}`);
  }

  return {
    data: Buffer.from(await res.arrayBuffer()),
    mimeType: existing.mimeType || "application/octet-stream",
  };
}

/** Delete a file by logical id. Missing files are ignored. */
export async function deleteDriveFile(logicalId: string): Promise<void> {
  const cfg = getOAuthConfig();
  if (!cfg) throw new Error("Google Drive belum dikonfigurasi (GOOGLE_DRIVE_*).");
  const token = await getAccessToken(cfg);
  const existing = await findFile(driveFileName(logicalId), cfg, token);
  if (!existing) return;

  const res = await fetch(`${DRIVE_API}/${existing.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google Drive delete gagal (${res.status}): ${detail.slice(0, 300)}`);
  }
}

/**
 * Verification helper: validates the OAuth2 credentials and folder access.
 */
export async function verifyDrive(): Promise<{ ok: boolean; message: string }> {
  const cfg = getOAuthConfig();
  if (!cfg) {
    return {
      ok: false,
      message: "Google Drive belum dikonfigurasi: GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN, dan GOOGLE_DRIVE_FOLDER_ID wajib diisi.",
    };
  }
  try {
    const token = await getAccessToken(cfg);
    const res = await fetch(
      `${DRIVE_API}?q=${encodeURIComponent(`'${cfg.folderId}' in parents and trashed=false`)}&fields=files(id,name)&pageSize=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, message: `Folder tidak dapat diakses (${res.status}): ${detail.slice(0, 200)}` };
    }
    return { ok: true, message: "Google Drive terhubung dan folder dapat diakses." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Build the Google OAuth2 authorization URL for setup. */
export function buildAuthUrl(redirectUri: string): string {
  const clientId = env("GOOGLE_DRIVE_CLIENT_ID");
  if (!clientId) throw new Error("GOOGLE_DRIVE_CLIENT_ID belum diisi.");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
}

/** Exchange an authorization code for tokens. */
export async function exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken: string }> {
  const cfg = getOAuthConfig();
  if (!cfg) throw new Error("GOOGLE_DRIVE_CLIENT_ID / CLIENT_SECRET belum diisi.");

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Token exchange gagal (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as { access_token: string; refresh_token: string };
  if (!data.refresh_token) {
    throw new Error("Tidak mendapat refresh_token. Pastikan prompt=consent dan access_type=offline.");
  }

  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}
