import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import {
  REMEMBER_TTL_SECONDS,
  createSessionToken,
  getSessionSecret,
  sessionCookie,
} from "@/lib/session";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, password, type, remember } = body as {
      username?: string;
      password?: string;
      type?: "staff" | "member";
      remember?: boolean;
    };

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username dan password wajib diisi." },
        { status: 400 }
      );
    }

    const trimmedUsername = username.trim().toLowerCase();

    // Find member by username (case-insensitive)
    const rows = await db
      .select()
      .from(members)
      .where(or(eq(members.username, trimmedUsername), eq(members.username, username.trim())))
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Akun tidak ditemukan. Periksa username Anda." },
        { status: 401 }
      );
    }

    const member = rows[0];

    // Check password (plain text comparison — matching existing pattern)
    if (member.password !== password) {
      return NextResponse.json(
        { error: "Password salah. Silakan coba lagi." },
        { status: 401 }
      );
    }

    // Check status
    if (member.status !== "Aktif") {
      return NextResponse.json(
        { error: "Akun Anda tidak aktif. Hubungi administrator." },
        { status: 403 }
      );
    }

    const role = member.role || "Siswa";

    // Route based on requested type and actual role
    if (type === "staff") {
      // Staff login — only Admin role allowed
      if (role !== "Admin") {
        return NextResponse.json(
          { error: "Akun ini bukan akun admin. Gunakan tab Anggota untuk login." },
          { status: 403 }
        );
      }
      return sessionResponse(
        await buildSessionCookie(member.code, "staff", member.name, remember === true),
        {
          ok: true,
          role: "staff",
          name: member.name,
          code: member.code,
        },
      );
    }

    // Member login — Guru and Siswa allowed
    if (role === "Admin") {
      return NextResponse.json(
        { error: "Akun admin harus masuk melalui tab Petugas." },
        { status: 403 }
      );
    }

    return sessionResponse(
      await buildSessionCookie(member.code, "member", member.name, remember === true),
      {
        ok: true,
        role: "member",
        memberCode: member.code,
        name: member.name,
      },
    );
  } catch (err) {
    console.error("POST /api/auth/login error:", err);

    return NextResponse.json(
      { error: "Gagal melakukan login. Silakan coba lagi." },
      { status: 500 }
    );
  }
}

/** Buat header cookie sesi; gagal keras bila rahasia sesi belum dikonfigurasi. */
async function buildSessionCookie(
  code: string,
  role: "staff" | "member",
  name: string,
  remember: boolean,
): Promise<string> {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error(
      "SESSION_SECRET belum diatur — sesi login tidak dapat dibuat.",
    );
  }
  const ttl = remember ? REMEMBER_TTL_SECONDS : undefined;
  const token = await createSessionToken({ code, role, name }, secret, ttl);
  return sessionCookie(token, remember);
}

function sessionResponse(cookie: string, payload: Record<string, unknown>) {
  const res = NextResponse.json(payload);
  res.headers.set("Set-Cookie", cookie);
  return res;
}
