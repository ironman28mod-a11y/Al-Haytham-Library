import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { members } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key === "code") continue;
      updates[key] = value;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    await db.update(members).set(updates).where(eq(members.code, code));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/members/[code] error:", err);
    return NextResponse.json({ error: "Failed to update member" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    await db.delete(members).where(eq(members.code, code));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/members/[code] error:", err);
    return NextResponse.json({ error: "Failed to delete member" }, { status: 500 });
  }
}
