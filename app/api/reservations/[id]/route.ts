import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reservations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.delete(reservations).where(eq(reservations.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/reservations/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete reservation" }, { status: 500 });
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key === "id") continue;
      updates[key] = value;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    await db.update(reservations).set(updates).where(eq(reservations.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/reservations/[id] error:", err);
    return NextResponse.json({ error: "Failed to update reservation" }, { status: 500 });
  }
}
