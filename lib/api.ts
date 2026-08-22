/**
 * API client for the Next.js backend (PostgreSQL).
 *
 * In development the Next.js API routes run on the same origin,
 * so API_BASE can be empty. In production set NEXT_PUBLIC_API_URL
 * if the API is hosted on a separate domain.
 */

const CONFIGURED_API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").trim().replace(/\/$/, "");

// The application API is served by the same Next.js deployment. Always use
// relative URLs in the browser so a stale/misconfigured public env var cannot
// send requests to the wrong host.
function apiBase() {
  return typeof window === "undefined" ? CONFIGURED_API_BASE : "";
}

export function isRemoteConfigured() {
  return Boolean(apiBase() || typeof window !== "undefined");
}

export function fileUrl(id: string) {
  return `${apiBase()}/api/files/${encodeURIComponent(id)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${apiBase()}${path}`;
  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: unknown } | null;
    const message = typeof body?.error === "string" && body.error.trim()
      ? body.error.trim()
      : `API error ${res.status}${res.statusText ? `: ${res.statusText}` : ""}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/* ── Types (mirror the browser-side types) ─────────────────── */

export type Book = {
  code: string;
  title: string;
  author: string;
  category: string;
  stock: number;
  available: number;
  color: string;
  initials: string;
  coverId?: string;
  coverName?: string;
};

export type EBook = Book & {
  format: string;
  size: string;
  access: string;
  fileName?: string;
  fileId?: string;
};

export type Member = {
  code: string;
  name: string;
  className: string;
  joined: string;
  status: string;
  initials: string;
  color: string;
  role: "Admin" | "Guru" | "Siswa";
  username: string;
  password: string;
  avatarData?: string;
  avatarName?: string;
};

export type LoanStatus = "Dipinjam" | "Terlambat" | "Dikembalikan";

export type Loan = {
  id: string;
  member: string;
  memberCode: string;
  book: string;
  bookCode: string;
  borrowed: string;
  borrowedDate?: string;
  due: string;
  dueDate?: string;
  returnedDate?: string;
  status: LoanStatus;
  avatar: string;
  color: string;
  avatarData?: string;
};

export type ProfileData = {
  name: string;
  email: string;
  phone: string;
  bio: string;
  role: "staff" | "student";
  detail: string;
  avatarData?: string;
  avatarName?: string;
};

/* ── File API ──────────────────────────────────────────────── */

export async function uploadFile(id: string, file: Blob, fileName?: string): Promise<void> {
  const headers = new Headers({ "Content-Type": file.type || "application/octet-stream", "X-File-Size": String(file.size) });
  if (fileName) headers.set("x-file-name", fileName);
  const res = await fetch(fileUrl(id), { method: "PUT", headers, body: file });
  if (!res.ok) throw new Error(`File upload failed (${res.status})`);
}

export async function downloadFile(id: string): Promise<Blob | null> {
  const res = await fetch(fileUrl(id));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`File download failed (${res.status})`);
  return res.blob();
}

export async function deleteFile(id: string): Promise<void> {
  const res = await fetch(fileUrl(id), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`File delete failed (${res.status})`);
}

/* ── Books API ─────────────────────────────────────────────── */

export async function fetchBooks(): Promise<Book[]> {
  return request<Book[]>("/api/books");
}

export async function createBook(book: Book): Promise<void> {
  await request("/api/books", { method: "POST", body: JSON.stringify(book) });
}

export async function updateBook(book: Partial<Book> & { code: string }): Promise<void> {
  await request(`/api/books/${encodeURIComponent(book.code)}`, { method: "PUT", body: JSON.stringify(book) });
}

export async function deleteBook(code: string): Promise<void> {
  await request(`/api/books/${encodeURIComponent(code)}`, { method: "DELETE" });
}

/* ── E-Books API ───────────────────────────────────────────── */

export async function fetchEbooks(): Promise<EBook[]> {
  return request<EBook[]>("/api/ebooks");
}

export async function createEbook(ebook: EBook): Promise<void> {
  await request("/api/ebooks", { method: "POST", body: JSON.stringify(ebook) });
}

export async function updateEbook(ebook: Partial<EBook> & { code: string }): Promise<void> {
  await request(`/api/ebooks/${encodeURIComponent(ebook.code)}`, { method: "PUT", body: JSON.stringify(ebook) });
}

export async function deleteEbook(code: string): Promise<void> {
  await request(`/api/ebooks/${encodeURIComponent(code)}`, { method: "DELETE" });
}

/* ── Members API ───────────────────────────────────────────── */

export async function fetchMembers(): Promise<Member[]> {
  return request<Member[]>("/api/members");
}

export async function createMember(member: Member): Promise<void> {
  await request("/api/members", { method: "POST", body: JSON.stringify(member) });
}

export async function updateMember(member: Partial<Member> & { code: string }): Promise<void> {
  await request(`/api/members/${encodeURIComponent(member.code)}`, { method: "PUT", body: JSON.stringify(member) });
}

export async function deleteMember(code: string): Promise<void> {
  await request(`/api/members/${encodeURIComponent(code)}`, { method: "DELETE" });
}

/* ── Loans API ─────────────────────────────────────────────── */

export async function fetchLoans(): Promise<Loan[]> {
  return request<Loan[]>("/api/loans");
}

export async function createLoan(loan: Loan): Promise<void> {
  await request("/api/loans", { method: "POST", body: JSON.stringify(loan) });
}

export async function returnLoan(id: string): Promise<void> {
  await request(`/api/loans/${encodeURIComponent(id)}/return`, { method: "POST" });
}

/* ── Categories API ────────────────────────────────────────── */

export async function fetchCategories(): Promise<string[]> {
  return request<string[]>("/api/categories");
}

export async function createCategory(name: string): Promise<void> {
  await request("/api/categories", { method: "POST", body: JSON.stringify({ name }) });
}

export async function deleteCategory(name: string): Promise<void> {
  await request(`/api/categories/${encodeURIComponent(name)}`, { method: "DELETE" });
}

/* ── Classes API ───────────────────────────────────────────── */

export async function fetchClasses(): Promise<string[]> {
  return request<string[]>("/api/classes");
}

export async function createClass(name: string): Promise<void> {
  await request("/api/classes", { method: "POST", body: JSON.stringify({ name }) });
}

export async function deleteClass(name: string): Promise<void> {
  await request(`/api/classes/${encodeURIComponent(name)}`, { method: "DELETE" });
}

/* ── Profile API ───────────────────────────────────────────── */

export async function fetchProfile(): Promise<ProfileData> {
  return request<ProfileData>("/api/profile");
}

export async function updateProfile(profile: ProfileData): Promise<void> {
  await request("/api/profile", { method: "PUT", body: JSON.stringify(profile) });
}

/* ── Settings / KV API ─────────────────────────────────────── */

export async function fetchSetting(key: string): Promise<string | null> {
  return request<string | null>(`/api/settings/${encodeURIComponent(key)}`);
}

export async function saveSetting(key: string, value: string): Promise<void> {
  await request(`/api/settings/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ value }) });
}

/* ── Reservations API ─────────────────────────────────────── */

export type ReservationStatus = "Menunggu" | "Tersedia" | "Selesai" | "Dibatalkan";

export type Reservation = {
  id: string;
  member: string;
  memberCode: string;
  book: string;
  bookCode: string;
  reservedAt: string;
  status: ReservationStatus;
  notifiedAt?: string;
  avatar: string;
  color: string;
  avatarData?: string;
};

export async function fetchReservations(): Promise<Reservation[]> {
  return request<Reservation[]>("/api/reservations");
}

export async function createReservation(reservation: Reservation): Promise<Reservation> {
  return request<Reservation>("/api/reservations", { method: "POST", body: JSON.stringify(reservation) });
}

export async function deleteReservation(id: string): Promise<void> {
  await request(`/api/reservations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function updateReservation(id: string, updates: Partial<Reservation>): Promise<void> {
  await request(`/api/reservations/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(updates) });
}

export async function notifyReservation(id: string): Promise<void> {
  await request(`/api/reservations/${encodeURIComponent(id)}/notify`, { method: "POST" });
}

/* ── Seed API ──────────────────────────────────────────────── */

export async function seedDatabase(data: {
  books?: Book[];
  ebooks?: EBook[];
  members?: Member[];
  loans?: Loan[];
  categories?: string[];
  classes?: string[];
}): Promise<void> {
  await request("/api/seed", { method: "POST", body: JSON.stringify(data) });
}
