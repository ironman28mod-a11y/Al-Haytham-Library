import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { loans, books } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const today = new Date().toISOString().slice(0, 10);

    // Update loan status to returned
    await db
      .update(loans)
      .set({ status: "Dikembalikan", returnedDate: today })
      .where(eq(loans.id, id));

    // Find the loan to get bookCode
    const [loan] = await db.select().from(loans).where(eq(loans.id, id)).limit(1);
    if (loan?.bookCode) {
      // Increment book availability
      await db
        .update(books)
        .set({ available: sql`${books.available} + 1` })
        .where(eq(books.code, loan.bookCode));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/loans/[id]/return error:", err);
    return NextResponse.json({ error: "Failed to return loan" }, { status: 500 });
  }
}
