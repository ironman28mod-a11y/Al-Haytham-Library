import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const rows = await db.select().from(members).orderBy(desc(members.code));
    return NextResponse.json(rows);
  } catch (err) {
    console.error("GET /api/members error:", err);
    return NextResponse.json({ error: "Failed to fetch members" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.code || !body.name) {
      return NextResponse.json({ error: "code and name are required" }, { status: 400 });
    }
    await db.insert(members).values({
      code: body.code,
      name: body.name,
      className: body.className || "",
      joined: body.joined || "",
      status: body.status || "Aktif",
      initials: body.initials || "",
      color: body.color || "#cfe4da",
      role: body.role || "Siswa",
      username: body.username || "",
      password: body.password || "",
      avatarData: body.avatarData || null,
      avatarName: body.avatarName || null,
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("POST /api/members error:", err);
    return NextResponse.json({ error: "Failed to create member" }, { status: 500 });
  }
}
