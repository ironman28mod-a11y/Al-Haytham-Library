import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/drive";

/**
 * OAuth2 callback — Google redirects here after the user authorizes.
 *
 * On success the page shows the refresh_token so the user can paste it
 * into .env.local (or Vercel env vars).
 *
 * Local redirect_uri:  http://localhost:3000/api/auth/drive/callback
 * Prod redirect_uri:   https://YOUR_DOMAIN/api/auth/drive/callback
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return new Response(
      `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:20px">
        <h2>❌ Otorisasi gagal</h2>
        <p>Error: <code>${error}</code></p>
        <p>Coba jalankan ulang setup dan klik link otorisasi lagi.</p>
      </body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  try {
    const { refreshToken } = await exchangeCode(code, getRedirectUri(req));

    return new Response(
      `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:700px;margin:40px auto;padding:20px">
        <h2>✅ Otorisasi Google Drive berhasil!</h2>
        <p>Sekarang tambahkan baris berikut ke <code>.env.local</code> kamu:</p>
        <pre style="background:#f5f5f5;padding:12px;border-radius:6px;overflow-x:auto;font-size:14px">GOOGLE_DRIVE_REFRESH_TOKEN=${refreshToken}</pre>
        <p>Lalu jalankan ulang:</p>
        <pre style="background:#f5f5f5;padding:12px;border-radius:6px">node scripts/verify-google-drive.mjs</pre>
        <hr>
        <p style="color:#666;font-size:13px"><b>Penting:</b> Simpan refresh_token ini di tempat aman. Jangan share ke siapapun. Jika hilang, jalankan ulang setup.</p>
      </body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      `<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:20px">
        <h2>❌ Token exchange gagal</h2>
        <p><code>${msg}</code></p>
        <p>Pastikan GOOGLE_DRIVE_CLIENT_ID dan GOOGLE_DRIVE_CLIENT_SECRET sudah benar di .env.local.</p>
      </body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }
}

function getRedirectUri(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}/api/auth/drive/callback`;
}
