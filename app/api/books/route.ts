import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { books } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const rows = await db.select().from(books).orderBy(desc(books.code));
    return NextResponse.json(rows);
  } catch (err) {
    console.error("GET /api/books error:", err);
    return NextResponse.json({ error: "Failed to fetch books" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.code || !body.title) {
      return NextResponse.json({ error: "code and title are required" }, { status: 400 });
    }
    await db.insert(books).values({
      code: body.code,
      title: body.title,
      author: body.author || "",
      category: body.category || "",
      stock: body.stock ?? 1,
      available: body.available ?? 1,
      color: body.color || "#e5f2ee",
      initials: body.initials || "",
      coverId: body.coverId || null,
      coverName: body.coverName || null,
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("POST /api/books error:", err);
    const pgError = err as { code?: string; cause?: { code?: string; message?: string }; message?: string };
    const errorCode = pgError?.code ?? pgError?.cause?.code;
    if (errorCode === "23505") {
      return NextResponse.json({ error: "Kode buku sudah dipakai di database. Coba lagi." }, { status: 409 });
    }
    const detail = pgError?.cause?.message ?? pgError?.message ?? "kesalahan tidak diketahui";
    return NextResponse.json({ error: `Gagal menyimpan ke database: ${detail}` }, { status: 500 });
  }
}
