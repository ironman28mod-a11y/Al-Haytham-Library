import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

/** Menghapus cookie sesi di sisi server sehingga token lama benar-benar tidak berlaku. */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", clearSessionCookie());
  return res;
}
