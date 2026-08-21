import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { books, ebooks, members, loans, categories, classes } from "@/lib/db/schema";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.categories?.length) {
      for (const name of body.categories) {
        await db.insert(categories).values({ name }).onConflictDoNothing();
      }
    }

    if (body.classes?.length) {
      for (const name of body.classes) {
        await db.insert(classes).values({ name }).onConflictDoNothing();
      }
    }

    if (body.books?.length) {
      for (const book of body.books) {
        await db
          .insert(books)
          .values({
            code: book.code,
            title: book.title,
            author: book.author || "",
            category: book.category || "",
            stock: book.stock ?? 1,
            available: book.available ?? 1,
            color: book.color || "#e5f2ee",
            initials: book.initials || "",
            coverId: book.coverId || null,
            coverName: book.coverName || null,
          })
          .onConflictDoUpdate({
            target: books.code,
            set: {
              title: book.title,
              author: book.author || "",
              category: book.category || "",
              stock: book.stock ?? 1,
              available: book.available ?? 1,
              color: book.color || "#e5f2ee",
              initials: book.initials || "",
              coverId: book.coverId || null,
              coverName: book.coverName || null,
            },
          });
      }
    }

    if (body.ebooks?.length) {
      for (const ebook of body.ebooks) {
        await db
          .insert(ebooks)
          .values({
            code: ebook.code,
            title: ebook.title,
            author: ebook.author || "",
            category: ebook.category || "",
            stock: ebook.stock ?? 0,
            available: ebook.available ?? 0,
            color: ebook.color || "#dcefe6",
            initials: ebook.initials || "",
            format: ebook.format || "PDF",
            size: ebook.size || "0 KB",
            access: ebook.access || "Baca online",
            fileName: ebook.fileName || null,
            fileId: ebook.fileId || null,
          })
          .onConflictDoUpdate({
            target: ebooks.code,
            set: {
              title: ebook.title,
              author: ebook.author || "",
              category: ebook.category || "",
              stock: ebook.stock ?? 0,
              available: ebook.available ?? 0,
              color: ebook.color || "#dcefe6",
              initials: ebook.initials || "",
              format: ebook.format || "PDF",
              size: ebook.size || "0 KB",
              access: ebook.access || "Baca online",
              fileName: ebook.fileName || null,
              fileId: ebook.fileId || null,
            },
          });
      }
    }

    if (body.members?.length) {
      for (const member of body.members) {
        await db
          .insert(members)
          .values({
            code: member.code,
            name: member.name,
            className: member.className || "",
            joined: member.joined || "",
            status: member.status || "Aktif",
            initials: member.initials || "",
            color: member.color || "#cfe4da",
            role: member.role || "Siswa",
            username: member.username || "",
            password: member.password || "",
            avatarData: member.avatarData || null,
            avatarName: member.avatarName || null,
          })
          .onConflictDoUpdate({
            target: members.code,
            set: {
              name: member.name,
              className: member.className || "",
              joined: member.joined || "",
              status: member.status || "Aktif",
              initials: member.initials || "",
              color: member.color || "#cfe4da",
              role: member.role || "Siswa",
              username: member.username || "",
              password: member.password || "",
              avatarData: member.avatarData || null,
              avatarName: member.avatarName || null,
            },
          });
      }
    }

    if (body.loans?.length) {
      for (const loan of body.loans) {
        await db
          .insert(loans)
          .values({
            id: loan.id,
            member: loan.member,
            memberCode: loan.memberCode || "",
            book: loan.book,
            bookCode: loan.bookCode || "",
            borrowed: loan.borrowed || "",
            borrowedDate: loan.borrowedDate || null,
            due: loan.due || "",
            dueDate: loan.dueDate || null,
            returnedDate: loan.returnedDate || null,
            status: loan.status || "Dipinjam",
            avatar: loan.avatar || "",
            color: loan.color || "#cfe4da",
            avatarData: loan.avatarData || null,
          })
          .onConflictDoUpdate({
            target: loans.id,
            set: {
              member: loan.member,
              memberCode: loan.memberCode || "",
              book: loan.book,
              bookCode: loan.bookCode || "",
              borrowed: loan.borrowed || "",
              borrowedDate: loan.borrowedDate || null,
              due: loan.due || "",
              dueDate: loan.dueDate || null,
              returnedDate: loan.returnedDate || null,
              status: loan.status || "Dipinjam",
              avatar: loan.avatar || "",
              color: loan.color || "#cfe4da",
              avatarData: loan.avatarData || null,
            },
          });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/seed error:", err);
    return NextResponse.json({ error: "Failed to seed database" }, { status: 500 });
  }
}
