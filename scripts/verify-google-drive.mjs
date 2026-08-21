/**
 * Verifikasi koneksi Google Drive (OAuth2).
 *
 * Jalankan setelah GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET,
 * GOOGLE_DRIVE_REFRESH_TOKEN, dan GOOGLE_DRIVE_FOLDER_ID terisi di .env.local.
 *
 *   node scripts/verify-google-drive.mjs
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
const env = {};
try {
  const c = readFileSync(envPath, "utf8");
  for (const l of c.split("\n")) {
    const t = l.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
} catch {}

const clientId = env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || "";
const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || "";
const refreshToken = env.GOOGLE_DRIVE_REFRESH_TOKEN || process.env.GOOGLE_DRIVE_REFRESH_TOKEN || "";
const folderId = env.GOOGLE_DRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID || "";

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

/* ── Validate env ─────────────────────────────────────────── */

let errors = 0;
function check(name, val) {
  if (!val) { console.log(`❌ ${name} — kosong.`); errors++; }
  else { console.log(`✅ ${name} — ${val.length > 50 ? val.slice(0, 50) + "..." : val}`); }
}

console.log("=== Memeriksa konfigurasi ===\n");
check("GOOGLE_DRIVE_CLIENT_ID", clientId);
check("GOOGLE_DRIVE_CLIENT_SECRET", clientSecret);
check("GOOGLE_DRIVE_REFRESH_TOKEN", refreshToken);
check("GOOGLE_DRIVE_FOLDER_ID", folderId);

if (errors > 0) {
  console.log("\n❌ Ada konfigurasi yang kurang. Isi dulu di .env.local, lalu coba lagi.");
  process.exit(1);
}

/* ── Get access token ─────────────────────────────────────── */

async function getAccessToken() {
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const d = await res.text();
    throw new Error(`OAuth refresh gagal (${res.status}): ${d.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error("Tidak mendapat access token.");
  return data.access_token;
}

/* ── Main ─────────────────────────────────────────────────── */

(async () => {
  console.log("\n=== Menguji koneksi ke Google ===\n");

  let token;
  try {
    token = await getAccessToken();
    console.log("✅ Access token didapat — kredensial valid.");
  } catch (err) {
    console.log(`❌ Gagal: ${err.message}`);
    console.log("\n   Pastikan CLIENT_ID, CLIENT_SECRET, dan REFRESH_TOKEN benar.");
    console.log("   Kalau refresh token hilang, jalankan: node scripts/setup-google-drive.mjs");
    process.exit(1);
  }

  console.log("\n=== Mengecek akses ke folder ===\n");

  try {
    const q = `'${folderId}' in parents and trashed=false`;
    const res = await fetch(
      `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const d = await res.text();
      throw new Error(`${res.status}: ${d.slice(0, 200)}`);
    }
    const data = await res.json();
    const files = data.files || [];
    console.log(`✅ Folder dapat diakses. Terdapat ${files.length} file.`);
    if (files.length > 0) {
      console.log("   File yang ada:");
      for (const f of files) console.log(`     • ${f.name}  (${f.mimeType})`);
    } else {
      console.log("   (Folder kosong — wajar untuk setup pertama.)");
    }
  } catch (err) {
    console.log(`❌ Folder tidak dapat diakses: ${err.message}`);
    console.log("\n   Pastikan GOOGLE_DRIVE_FOLDER_ID benar.");
    process.exit(1);
  }

  /* ── Test write + delete ────────────────────────────────── */

  console.log("\n=== Menguji tulis + hapus ===\n");

  const testName = "__alhaytham_test__.txt";
  const boundary = `alhaytham_verify_${Date.now()}`;
  const meta = JSON.stringify({ name: testName, parents: [folderId], mimeType: "text/plain" });
  const body = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\nOK — file ini dibuat otomatis oleh verify-google-drive.mjs.\r\n--${boundary}--\r\n`
  );

  try {
    const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) {
      const d = await res.text();
      throw new Error(`${res.status}: ${d.slice(0, 300)}`);
    }
    const file = await res.json();
    console.log(`✅ File tes berhasil dibuat: ${testName} (${file.id})`);

    // Cleanup
    const del = await fetch(`${DRIVE_API}/${file.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (del.ok || del.status === 404) console.log("✅ File tes berhasil dihapus.");
    else console.log("⚠️  File tes gagal dihapus (tidak kritis).");
  } catch (err) {
    console.log(`❌ Tes tulis/hapus gagal: ${err.message}`);
    process.exit(1);
  }

  console.log("\n🎉 Semua tes berhasil! Google Drive siap digunakan.\n");
})().catch((err) => {
  console.error("❌ Error tidak terduga:", err);
  process.exit(1);
});
