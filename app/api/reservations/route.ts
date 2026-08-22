import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { reservations } from "@/lib/db/schema";
import { desc, eq, and } from "drizzle-orm";

export async function GET() {
  try {
    const rows = await db.select().from(reservations).orderBy(desc(reservations.id));
    return NextResponse.json(rows);
  } catch (err) {
    console.error("GET /api/reservations error:", err);
    return NextResponse.json({ error: "Failed to fetch reservations" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.member || !body.book || !body.bookCode || !body.memberCode) {
      return NextResponse.json({ error: "member, book, bookCode, and memberCode are required" }, { status: 400 });
    }

    // Check if member already has an active reservation for this book
    const existing = await db
      .select()
      .from(reservations)
      .where(and(
        eq(reservations.memberCode, body.memberCode),
        eq(reservations.bookCode, body.bookCode),
        eq(reservations.status, "Menunggu")
      ));

    if (existing.length > 0) {
      return NextResponse.json({ error: "Anda sudah mengantri buku ini" }, { status: 409 });
    }

    const reservation = {
      id: `res-${Date.now()}`,
      member: body.member,
      memberCode: body.memberCode,
      book: body.book,
      bookCode: body.bookCode,
      reservedAt: body.reservedAt || new Date().toISOString().slice(0, 10),
      status: body.status || "Menunggu",
      avatar: body.avatar || "",
      color: body.color || "#cfe4da",
      avatarData: body.avatarData || null,
    };

    await db.insert(reservations).values(reservation);
    return NextResponse.json(reservation, { status: 201 });
  } catch (err) {
    console.error("POST /api/reservations error:", err);
    return NextResponse.json({ error: "Failed to create reservation" }, { status: 500 });
  }
}
