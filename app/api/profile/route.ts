import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { profile } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const DEFAULT_PROFILE = {
  name: "Rina Nuraini",
  email: "rina.nuraini@alhaytham.sch.id",
  phone: "",
  bio: "",
  role: "staff",
  detail: "Administrator",
};

export async function GET() {
  try {
    const [row] = await db.select().from(profile).where(eq(profile.id, 1)).limit(1);
    return NextResponse.json(row ?? DEFAULT_PROFILE);
  } catch (err) {
    console.error("GET /api/profile error:", err);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    await db
      .insert(profile)
      .values({
        id: 1,
        name: body.name || "Rina Nuraini",
        email: body.email || "",
        phone: body.phone || "",
        bio: body.bio || "",
        role: body.role || "staff",
        detail: body.detail || "",
        avatarData: body.avatarData || null,
        avatarName: body.avatarName || null,
      })
      .onConflictDoUpdate({
        target: profile.id,
        set: {
          name: body.name || "Rina Nuraini",
          email: body.email || "",
          phone: body.phone || "",
          bio: body.bio || "",
          role: body.role || "staff",
          detail: body.detail || "",
          avatarData: body.avatarData || null,
          avatarName: body.avatarName || null,
        },
      });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/profile error:", err);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
