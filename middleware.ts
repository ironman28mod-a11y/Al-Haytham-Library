import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "@/lib/session";

/**
 * Gerbang keamanan API.
 *
 * Sebelum ada middleware ini, semua endpoint /api bisa diakses tanpa login —
 * termasuk GET /api/members (berisi data siswa beserta password) dan
 * DELETE /api/ebooks. Middleware ini mewajibkan cookie sesi yang sudah
 * ditandatangani, lalu membatasi tindakan tulis sesuai peran.
 */

// Endpoint yang memang terbuka (tanpa sesi).
const PUBLIC_PATHS = new Set([
  "/api/health",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/drive/callback",
]);

// Tulis data yang tetap diizinkan untuk anggota (Guru/Siswa) yang sudah login.
// Semua tindakan tulis lain (tambah/hapus buku, e-book, anggota, kategori,
// kelas, pengaturan, reservasi, file, seed) khusus petugas (Admin).
const MEMBER_WRITE_RULES: Array<{ pattern: RegExp; methods: string[] }> = [
  { pattern: /^\/api\/loans(\/|$)/, methods: ["POST"] },
  { pattern: /^\/api\/reservations$/, methods: ["POST"] },
  { pattern: /^\/api\/books\/[^/]+$/, methods: ["PUT"] },
  { pattern: /^\/api\/members(\/[^/]+)?$/, methods: ["PUT"] },
];

function deny(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function safeDecodeId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!pathname.startsWith("/api/")) return NextResponse.next();
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const session = await sessionFromRequest(req);
  if (!session) {
    return deny("Sesi Anda belum aktif. Silakan masuk kembali.", 401);
  }

  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return NextResponse.next();

  // Unggah/hapus file: petugas bebas; anggota hanya untuk foto profilnya sendiri.
  if (pathname.startsWith("/api/files/") && (method === "PUT" || method === "DELETE")) {
    if (session.role === "member") {
      const fileId = safeDecodeId(pathname.slice("/api/files/".length));
      if (method === "PUT" && fileId === `member-avatar:${session.code}`) return NextResponse.next();
      return deny("Anda tidak memiliki akses untuk mengubah file ini.", 403);
    }
    return NextResponse.next();
  }

  if (session.role === "staff") return NextResponse.next();

  const allowed = MEMBER_WRITE_RULES.some(
    (rule) => rule.methods.includes(method) && rule.pattern.test(pathname),
  );
  if (allowed) return NextResponse.next();

  return deny("Anda tidak memiliki akses untuk tindakan ini.", 403);
}

export const config = {
  matcher: ["/api/:path*"],
};
