/**
 * Setup wizard untuk Google Drive OAuth2.
 *
 * Jalankan setelah mengisi GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET,
 * dan GOOGLE_DRIVE_FOLDER_ID di .env.local.
 *
 *   node scripts/setup-google-drive.mjs
 *
 * Script akan:
 *   1. Mengecek konfigurasi env
 *   2. Membuka browser untuk otorisasi Google
 *   3. Menampilkan refresh_token untuk disimpan ke .env.local
 */

import { readFileSync, writeFileSync, appendFileSync } from "fs";
import { resolve } from "path";
import { createInterface } from "readline";

const envPath = resolve(process.cwd(), ".env.local");

/* ── Load .env.local ──────────────────────────────────────── */

const env = {};
try {
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
} catch {}

const clientId = env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID || "";
const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_DRIVE_CLIENT_SECRET || "";
const folderId = env.GOOGLE_DRIVE_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID || "";

/* ── Validate ─────────────────────────────────────────────── */

console.log("=== Google Drive OAuth2 Setup ===\n");

let errors = 0;
function check(name, val) {
  if (!val) {
    console.log(`❌ ${name} — kosong.`);
    errors++;
  } else {
    const preview = val.length > 40 ? val.slice(0, 40) + "..." : val;
    console.log(`✅ ${name} — ${preview}`);
  }
}

check("GOOGLE_DRIVE_CLIENT_ID", clientId);
check("GOOGLE_DRIVE_CLIENT_SECRET", clientSecret);
check("GOOGLE_DRIVE_FOLDER_ID", folderId);

if (errors > 0) {
  console.log("\n❌ Isi dulu variabel yang kosong di .env.local, lalu jalankan ulang script ini.");
  process.exit(1);
}

/* ── Build redirect URI ───────────────────────────────────── */

const REDIRECT_URI = "http://localhost:3000/api/auth/drive/callback";
const params = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/drive.file",
  access_type: "offline",
  prompt: "consent",
});
const authUrl = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;

/* ── Open browser and guide user ──────────────────────────── */

console.log(`\n--- Langkah 1: Otorisasi ---\n`);
console.log(`Buka link ini di browser kamu:\n`);
console.log(`  ${authUrl}\n`);
console.log(`Atau jalankan command berikut (akan otomatis buka browser):\n`);
console.log(`  start "${authUrl}"\n`);

// Try to open browser automatically
import("child_process").then(({ exec }) => {
  const platform = process.platform;
  if (platform === "win32") exec(`start "" "${authUrl}"`);
  else if (platform === "darwin") exec(`open "${authUrl}"`);
  else exec(`xdg-open "${authUrl}"`);
}).catch(() => {});

console.log(`Setelah kamu klik "Izinkan" di browser, Google akan redirect ke:
  ${REDIRECT_URI}

Jika halaman menampilkan error "This site can't be reached" (karena dev server belum jalan),
salin SELURUH URL dari address bar browser (yang diawali http://localhost:3000/api/auth/drive/callback?code=...),
lalu paste di bawah.\n`);

/* ── Prompt user for code or URL ──────────────────────────── */

const rl = createInterface({ input: process.stdin, output: process.stdout });

rl.question("Paste URL atau code dari browser: ", async (input) => {
  rl.close();

  let code = input.trim();

  // Extract code from full URL if pasted
  if (code.includes("code=")) {
    try {
      const url = new URL(code);
      code = url.searchParams.get("code") || code;
    } catch {
      // Not a URL, try extracting manually
      const match = code.match(/code=([^&]+)/);
      if (match) code = match[1];
    }
  }

  if (!code) {
    console.log("\n❌ Tidak ada code yang dimasukkan.");
    process.exit(1);
  }

  console.log(`\n--- Langkah 2: Menukar code untuk token ---\n`);

  try {
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
      console.log(`❌ Token exchange gagal (${res.status}): ${detail.slice(0, 300)}`);
      process.exit(1);
    }

    const data = await res.json();

    if (!data.refresh_token) {
      console.log("❌ Tidak mendapat refresh_token. Pastikan:");
      console.log("   - Kamu klik 'Izinkan' (bukan 'Tolak')");
      console.log("   - Ini pertama kali otorisasi (jika sudah pernah, revoke akses dulu di https://myaccount.google.com/permissions)");
      process.exit(1);
    }

    console.log("✅ Berhasil mendapat refresh_token!\n");

    // Check if .env.local already has GOOGLE_DRIVE_REFRESH_TOKEN
    const hasExisting = Object.keys(env).includes("GOOGLE_DRIVE_REFRESH_TOKEN");

    if (hasExisting) {
      console.log("Refresh token sudah ada di .env.local. Mengupdate...");
      const content = readFileSync(envPath, "utf8");
      const updated = content.replace(
        /^GOOGLE_DRIVE_REFRESH_TOKEN=.*/m,
        `GOOGLE_DRIVE_REFRESH_TOKEN=${data.refresh_token}`
      );
      writeFileSync(envPath, updated, "utf8");
    } else {
      console.log("Menambahkan refresh token ke .env.local...");
      appendFileSync(envPath, `\nGOOGLE_DRIVE_REFRESH_TOKEN=${data.refresh_token}\n`, "utf8");
    }

    console.log(`\n--- Langkah 3: Verifikasi ---\n`);
    console.log("Jalankan perintah berikut untuk memastikan semua berjalan lancar:\n");
    console.log("  node scripts/verify-google-drive.mjs\n");

    // Quick verification
    console.log("--- Verifikasi cepat ---\n");
    const verifyRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&fields=files(id,name)&pageSize=1`,
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    );
    if (verifyRes.ok) {
      const d = await verifyRes.json();
      console.log(`✅ Folder dapat diakses (${d.files?.length || 0} file).`);
      console.log("\n🎉 Setup Google Drive selesai! Kamu siap deploy ke Vercel.\n");
    } else {
      const detail = await verifyRes.text();
      console.log(`⚠️  Folder tidak dapat diakses (${verifyRes.status}): ${detail.slice(0, 200)}`);
      console.log("\nPastikan GOOGLE_DRIVE_FOLDER_ID benar dan folder sudah di-share ke akun Google kamu.");
    }
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
});
