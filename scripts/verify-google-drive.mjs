/**
 * Verifikasi koneksi Google Drive.
 *
 * Jalankan setelah ketiga environment variable (GOOGLE_DRIVE_CLIENT_EMAIL,
 * GOOGLE_DRIVE_PRIVATE_KEY, GOOGLE_DRIVE_FOLDER_ID) terisi di .env.local.
 *
 *   node scripts/verify-google-drive.mjs
 *
 * Script ini akan:
 *   1. Memvalidasi konfigurasi env.
 *   2. Mendapatkan akses token dari Google (menguji client_email + private_key).
 *   3. Mengecek akses ke folder Drive.
 *   4. Opsional: membuat file tes kecil lalu menghapusnya (uji write).
 */

import { createSign } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";

/* ── Load .env.local ──────────────────────────────────────── */

const envPath = resolve(process.cwd(), ".env.local");
let env = {};
try {
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
} catch {
  console.log("⚠️  .env.local tidak ditemukan, gunakan environment variable yang sudah ada.\n");
}

const clientEmail = env.GOOGLE_DRIVE_CLIENT_EMAIL || process.env.GOOGLE_DRIVE_CLIENT_EMAIL || "";
const privateKey = (env.GOOGLE_DRIVE_PRIVATE_KEY || process.env.GOOGLE_DRIVE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const folderId = env.GOOGLE_DRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID || "";

/* ── Validasi ─────────────────────────────────────────────── */

let errors = 0;
function check(name, val) {
  if (!val) {
    console.log(`❌ ${name} — kosong. Pastikan sudah diisi di .env.local.`);
    errors++;
  } else {
    const preview = val.length > 60 ? val.slice(0, 60) + "..." : val;
    console.log(`✅ ${name} — ${preview}`);
  }
}
console.log("=== Memeriksa konfigurasi ===\n");
check("GOOGLE_DRIVE_CLIENT_EMAIL", clientEmail);
check("GOOGLE_DRIVE_PRIVATE_KEY", privateKey);
check("GOOGLE_DRIVE_FOLDER_ID", folderId);

if (errors > 0) {
  console.log("\n❌ Ada konfigurasi yang kurang. Isi dulu di .env.local, lalu coba lagi.");
  process.exit(1);
}

/* ── Google Drive REST helpers ─────────────────────────────── */

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (input) => Buffer.from(typeof input === "string" ? input : JSON.stringify(input)).toString("base64url");

  const header = b64url({ alg: "RS256", typ: "JWT" });
  const claims = b64url({
    iss: clientEmail,
    scope: SCOPES.join(" "),
    aud: TOKEN_URI,
    iat: now,
    exp: now + 3600,
  });

  const unsigned = `${header}.${claims}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(privateKey, "base64url");
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
    const detail = await res.text();
    throw new Error(`Google OAuth gagal (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error("Tidak mendapat access token dari Google.");
  return data.access_token;
}

/* ── Cek folder ───────────────────────────────────────────── */

(async () => {
  console.log("\n=== Menguji koneksi ke Google ===\n");

  let token;
  try {
    token = await getAccessToken();
    console.log("✅ Access token didapat — private key valid.");
  } catch (err) {
    console.log(`❌ Gagal mendapatkan access token: ${err.message}`);
    console.log("\n   Pastikan:");
    console.log("   - GOOGLE_DRIVE_CLIENT_EMAIL menggunakan 'client_email' dari JSON (bukan email pribadi).");
    console.log("   - GOOGLE_DRIVE_PRIVATE_KEY adalah SELURUH isi 'private_key' (termasuk -----BEGIN... sampai -----END-----).");
    process.exit(1);
  }

  console.log("\n=== Mengecek akses ke folder ===\n");

  let filesInFolder = [];
  try {
    const q = `'${folderId}' in parents and trashed=false`;
    const res = await fetch(
      `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)&pageSize=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = await res.json();
    filesInFolder = data.files || [];
    console.log(`✅ Folder dapat diakses. Terdapat ${filesInFolder.length} file.`);
    if (filesInFolder.length > 0) {
      console.log("   File yang ada:");
      for (const f of filesInFolder) {
        console.log(`     • ${f.name}  (${f.mimeType})`);
      }
    } else {
      console.log("   (Folder kosong — wajar untuk setup pertama.)");
    }
  } catch (err) {
    console.log(`❌ Folder tidak dapat diakses: ${err.message}`);
    console.log("\n   Pastikan:");
    console.log("   - GOOGLE_DRIVE_FOLDER_ID benar (ID dari URL https://drive.google.com/drive/folders/<ID>)");
    console.log(`   - Folder sudah di-share ke: ${clientEmail} (sebagai Editor)`);
    process.exit(1);
  }

  /* ── Opsional: tes tulis + hapus ────────────────────────── */

  const testName = "__alhaytham_test_file__.txt";
  const alreadyExists = filesInFolder.find((f) => f.name === testName);

  try {
    const boundary = `alhaytham_test_${Date.now()}`;
    const metadata = JSON.stringify({ name: testName, parents: [folderId], mimeType: "text/plain" });
    const body = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${metadata}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `OK — file ini dibuat otomatis oleh verify-google-drive.mjs.\r\n` +
        `--${boundary}--\r\n`
    );

    let fileId;
    if (alreadyExists) {
      const res = await fetch(`${DRIVE_UPLOAD}/${alreadyExists.id}?uploadType=multipart`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      });
      if (!res.ok) throw new Error("PATCH gagal");
      fileId = alreadyExists.id;
    } else {
      const res = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`${res.status}: ${detail.slice(0, 200)}`);
      }
      const data = await res.json();
      fileId = data.id;
    }

    console.log(`✅ File tes berhasil ${alreadyExists ? "diperbarui" : "dibuat"}: __alhaytham_test_file__.txt`);

    // Hapus file tes (clean up)
    await fetch(`${DRIVE_API}/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    console.log("✅ File tes berhasil dihapus (semua izin OK).");
  } catch (err) {
    console.log(`❌ Tes tulis/hapus gagal: ${err.message}`);
    console.log("\n   Pastikan service account punya izin Editor di folder.");
    process.exit(1);
  }

  console.log("\n🎉 Semua tes berhasil! Google Drive siap digunakan.\n");
})().catch((err) => {
  console.error("❌ Error tidak terduga:", err);
  process.exit(1);
});