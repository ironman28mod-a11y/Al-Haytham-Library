import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loans } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const rows = await db.select().from(loans).orderBy(desc(loans.id));
    return NextResponse.json(rows);
  } catch (err) {
    console.error("GET /api/loans error:", err);
    return NextResponse.json({ error: "Failed to fetch loans" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.id || !body.member || !body.book) {
      return NextResponse.json({ error: "id, member, and book are required" }, { status: 400 });
    }
    await db.insert(loans).values({
      id: body.id,
      member: body.member,
      memberCode: body.memberCode || "",
      book: body.book,
      bookCode: body.bookCode || "",
      borrowed: body.borrowed || "",
      borrowedDate: body.borrowedDate || null,
      due: body.due || "",
      dueDate: body.dueDate || null,
      status: body.status || "Dipinjam",
      avatar: body.avatar || "",
      color: body.color || "#cfe4da",
      avatarData: body.avatarData || null,
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("POST /api/loans error:", err);
    return NextResponse.json({ error: "Failed to create loan" }, { status: 500 });
  }
}
