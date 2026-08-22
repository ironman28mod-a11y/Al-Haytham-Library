import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reservations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const today = new Date().toISOString().slice(0, 10);

    await db
      .update(reservations)
      .set({ notifiedAt: today })
      .where(eq(reservations.id, id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/reservations/[id]/notify error:", err);
    return NextResponse.json({ error: "Failed to notify reservation" }, { status: 500 });
  }
}
