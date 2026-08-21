import { createSign } from "crypto";

/**
 * Minimal Google Drive client backed by a service account.
 *
 * It signs a JWT with the service-account private key (Node's built-in crypto),
 * exchanges it for an OAuth access token, and talks to the Drive REST API
 * directly — no external SDK required.
 *
 * Files are stored flat inside a single Drive folder. Each logical file id
 * (e.g. "book-cover:ABC", "ebook:XYZ", "member-avatar:001", "profile-avatar")
 * is sanitized into a unique Drive file name, so lookups are deterministic and
 * stateless (safe for Vercel serverless functions).
 */

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const SCOPES = ["https://www.googleapis.com/auth/drive.file"].join(" ");

type Credentials = {
  clientEmail: string;
  privateKey: string;
  folderId: string;
};

function getCredentials(): Credentials | null {
  const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL?.trim();
  const privateKey = (process.env.GOOGLE_DRIVE_PRIVATE_KEY ?? "")
    .replace(/\\n/g, "\n")
    .trim();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!clientEmail || !privateKey || !folderId) return null;
  return { clientEmail, privateKey, folderId };
}

export function isDriveConfigured(): boolean {
  return getCredentials() !== null;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(creds: Credentials): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const base64url = (input: string | object) =>
    Buffer.from(typeof input === "string" ? input : JSON.stringify(input)).toString("base64url");

  const header = base64url({ alg: "RS256", typ: "JWT" });
  const claims = base64url({
    iss: creds.clientEmail,
    scope: SCOPES,
    aud: TOKEN_URI,
    iat: now,
    exp: now + 3600,
  });

  const unsigned = `${header}.${claims}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(creds.privateKey, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google OAuth gagal (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as { access_token: string };
  if (!data.access_token) throw new Error("Google OAuth tidak mengembalikan access token");

  cachedToken = { token: data.access_token, expiresAt: Date.now() + 3500 * 1000 };
  return cachedToken.token;
}

/** Convert a logical file id into a safe, unique Drive file name. */
export function driveFileName(logicalId: string): string {
  return logicalId.replace(/[\\/:*?"<>|]/g, "_");
}

type DriveFile = { id: string; name: string; mimeType: string };

async function findFile(name: string, creds: Credentials, token: string): Promise<DriveFile | null> {
  const query = `name='${name.replace(/'/g, "\\'")}' and '${creds.folderId}' in parents and trashed=false`;
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
  const creds = getCredentials();
  if (!creds) throw new Error("Google Drive belum dikonfigurasi (GOOGLE_DRIVE_*).");
  const token = await getAccessToken(creds);
  const name = driveFileName(logicalId);
  const existing = await findFile(name, creds, token);

  const boundary = `alhaytham_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata: Record<string, unknown> = { name, mimeType: mimeType || "application/octet-stream" };
  if (!existing) metadata.parents = [creds.folderId];

  const res = await fetch(
    existing ? `${DRIVE_UPLOAD}/${existing.id}?uploadType=multipart` : `${DRIVE_UPLOAD}?uploadType=multipart`,
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
  const creds = getCredentials();
  if (!creds) throw new Error("Google Drive belum dikonfigurasi (GOOGLE_DRIVE_*).");
  const token = await getAccessToken(creds);
  const existing = await findFile(driveFileName(logicalId), creds, token);
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
  const creds = getCredentials();
  if (!creds) throw new Error("Google Drive belum dikonfigurasi (GOOGLE_DRIVE_*).");
  const token = await getAccessToken(creds);
  const existing = await findFile(driveFileName(logicalId), creds, token);
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
 * Verification helper used by the health check and the setup script:
 * validates the credentials and folder in one round trip.
 */
export async function verifyDrive(): Promise<{ ok: boolean; message: string }> {
  const creds = getCredentials();
  if (!creds) {
    return {
      ok: false,
      message: "Google Drive belum dikonfigurasi: GOOGLE_DRIVE_CLIENT_EMAIL, GOOGLE_DRIVE_PRIVATE_KEY, dan GOOGLE_DRIVE_FOLDER_ID wajib diisi.",
    };
  }
  try {
    const token = await getAccessToken(creds);
    const res = await fetch(
      `${DRIVE_API}?q=${encodeURIComponent(`'${creds.folderId}' in parents and trashed=false`)}&fields=files(id,name)&pageSize=1`,
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
