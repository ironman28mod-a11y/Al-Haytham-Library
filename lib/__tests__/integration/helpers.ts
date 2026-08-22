/**
 * Integration test helpers.
 *
 * Tests hit the real Vercel deployment by default.
 * Override with: API_BASE_URL=http://localhost:3000 vitest run --project integration
 */

const DEFAULT_BASE = "https://al-haytham-library.vercel.app";

export const BASE_URL = (process.env.API_BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, "");

/* ── Fetch wrapper ────────────────────────────────────────── */

export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<ApiResponse<T>> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  const data = (await res.json()) as T;
  return { status: res.status, data };
}

/* ── Unique test data generators ──────────────────────────── */

const timestamp = () => Date.now();

let counter = 0;
export function uid() {
  counter += 1;
  return `${timestamp()}${counter}`;
}

export function testBook() {
  const id = uid();
  return {
    code: `BK-TEST-${id}`,
    title: `Test Book ${id}`,
    author: "Integration Test",
    category: "Test",
    stock: 3,
    available: 3,
    color: "#e5f2ee",
    initials: "TB",
  };
}

export function testEbook() {
  const id = uid();
  return {
    code: `EB-TEST-${id}`,
    title: `Test E-Book ${id}`,
    author: "Integration Test",
    category: "Test",
    stock: 0,
    available: 0,
    color: "#dcefe6",
    initials: "TE",
    format: "PDF",
    size: "1.2 MB",
    access: "Baca online",
    fileName: `test-${id}.pdf`,
  };
}

export function testMember() {
  const id = uid();
  return {
    code: `AG-TEST-${id}`,
    name: `Test Student ${id}`,
    className: "X IPS 1",
    joined: "22 Aug 2026",
    status: "Aktif",
    initials: "TS",
    color: "#cfe4da",
    role: "Siswa",
    username: `test.student.${id}`,
    password: "TestPass123!",
  };
}

export function testLoan(member: { code: string; name: string; initials: string; color: string }, book: { code: string; title: string }) {
  const id = uid();
  return {
    id: `loan-test-${id}`,
    member: member.name,
    memberCode: member.code,
    book: book.title,
    bookCode: book.code,
    borrowed: "22 Aug 2026",
    due: "29 Aug 2026",
    status: "Dipinjam" as const,
    avatar: member.initials,
    color: member.color,
  };
}
