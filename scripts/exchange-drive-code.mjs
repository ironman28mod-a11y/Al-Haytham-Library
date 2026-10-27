/**
 * One-off helper: tukar authorization code Google OAuth untuk refresh token
 * dan simpan ke .env.local tanpa menampilkan nilai secret.
 *
 *   node scripts/exchange-drive-code.mjs "<code>"
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

let input = process.argv[2];
if (!input) {
  console.error("Pakai: node scripts/exchange-drive-code.mjs \"<URL callback atau code>\"");
  process.exit(1);
}
// Terima URL callback lengkap atau code mentah.
let code = input.trim();
if (code.includes("code=")) {
  try {
    code = new URL(code).searchParams.get("code") || code;
  } catch {
    code = code.match(/code=([^&]+)/)?.[1] || code;
  }
}

const envPath = resolve(process.cwd(), ".env.local");
const content = readFileSync(envPath, "utf8");
const env = {};
for (const line of content.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const clientId = env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID;
const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("GOOGLE_DRIVE_CLIENT_ID / CLIENT_SECRET kosong.");
  process.exit(1);
}

const REDIRECT_URI = "http://localhost:3000/api/auth/drive/callback";

const res = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  }),
});

if (!res.ok) {
  const detail = await res.text();
  console.error(`Token exchange gagal (${res.status}): ${detail.slice(0, 300)}`);
  process.exit(1);
}

const data = await res.json();
if (!data.refresh_token) {
  console.error("Tidak mendapat refresh_token dari Google (prompt=consent harus dipakai).");
  process.exit(1);
}

const hasExisting = /^GOOGLE_DRIVE_REFRESH_TOKEN=.*/m.test(content);
if (hasExisting) {
  writeFileSync(
    envPath,
    content.replace(/^GOOGLE_DRIVE_REFRESH_TOKEN=.*/m, `GOOGLE_DRIVE_REFRESH_TOKEN=${data.refresh_token}`),
    "utf8"
  );
} else {
  writeFileSync(envPath, `${content.trimEnd()}\nGOOGLE_DRIVE_REFRESH_TOKEN=${data.refresh_token}\n`, "utf8");
}

console.log(`✅ Refresh token baru tersimpan di .env.local (panjang ${data.refresh_token.length} karakter).`);
console.log("Jalankan: node scripts/verify-google-drive.mjs");
