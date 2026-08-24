"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../lib/api";

/* ---------- Types ---------- */
type PortalMember = api.Member;
type PortalBook = api.Book;
type PortalEBook = api.EBook;
type PortalLoan = api.Loan;
type PortalReservation = api.Reservation;

type MemberPage = "overview" | "ebooks" | "books" | "loans" | "reports" | "settings";
type ThemeMode = "auto" | "light" | "dark";

/* ---------- Browser File Storage (IndexedDB) ---------- */
const FILE_DB_NAME = "al-haytham-library-files";
const FILE_STORE_NAME = "files";
type BrowserFileRecord = { id: string; blob: Blob; compressed: boolean; originalType: string };

function openFileDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("IndexedDB tidak tersedia.")); return; }
    const req = window.indexedDB.open(FILE_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(FILE_STORE_NAME, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Database file tidak dapat dibuka."));
  });
}

async function loadBrowserFile(id: string) {
  const db = await openFileDatabase();
  try {
    const record = await new Promise<BrowserFileRecord | undefined>((resolve, reject) => {
      const req = db.transaction(FILE_STORE_NAME, "readonly").objectStore(FILE_STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result as BrowserFileRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!record) return null;
    if (!record.compressed || !("DecompressionStream" in window)) return record.blob;
    const stream = record.blob.stream().pipeThrough(new DecompressionStream("gzip"));
    return new Blob([await new Response(stream).arrayBuffer()], { type: record.originalType });
  } finally { db.close(); }
}

/* ---------- PDF Cover Extraction ---------- */
const pdfCoverCache = new Map<string, Promise<string | null>>();

async function renderPdfPageToDataUrl(blob: Blob, pageNumber: number, maxWidth: number) {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs").then(async (mod) => {
      const cached = await loadBrowserFile("pdfjs-worker-source").catch(() => null);
      mod.GlobalWorkerOptions.workerSrc = cached ? URL.createObjectURL(cached) : "/pdf.worker.min.mjs";
      return mod;
    });
    const data = new Uint8Array(await blob.arrayBuffer());
    const task = pdfjs.getDocument({ data, cMapUrl: "/cmaps/", cMapPacked: true, standardFontDataUrl: "/standard_fonts/", wasmUrl: "/wasm/" });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, maxWidth / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      task.destroy().catch(() => undefined);
      return dataUrl;
    } catch { return null; }
  } catch { return null; }
}

function getPdfCover(fileId: string, blob: Blob) {
  let pending = pdfCoverCache.get(fileId);
  if (!pending) { pending = renderPdfPageToDataUrl(blob, 1, 340); pdfCoverCache.set(fileId, pending); }
  return pending;
}

function ebookCoverCacheId(ebook: { fileId?: string; code: string; size: string; fileName?: string }) {
  return `ebook-cover:${ebook.fileId ?? ebook.code}:${ebook.size}:${ebook.fileName ?? ""}`;
}

async function dataUrlToBlob(dataUrl: string) {
  return (await fetch(dataUrl)).blob();
}

/* ---------- Helpers ---------- */
function formatDate(value?: string) {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)).replace(/\./g, "");
  }
  return value;
}

function fileLink(id: string) {
  return `/api/files/${encodeURIComponent(id)}`;
}

function getInitials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "AG";
}

function getLoanStatus(loan: PortalLoan) {
  if (loan.status === "Dikembalikan") return loan.status;
  const due = loan.dueDate ?? "";
  const today = new Date().toISOString().slice(0, 10);
  return due && due < today ? "Terlambat" : loan.status;
}

function dateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateAfterDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return dateInputValue(date);
}

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/* ---------- Icons ---------- */
type IconName =
  | "grid" | "book" | "users" | "repeat" | "sliders" | "logout"
  | "search" | "bell" | "plus" | "arrowUp" | "arrowDown"
  | "calendar" | "filter" | "download" | "upload" | "clock"
  | "check" | "alert" | "close" | "edit" | "trash"
  | "chevron" | "more" | "menu" | "rotate"
  | "user" | "card" | "barChart" | "monitor" | "settings";

function Icon({ name, size = 19, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    book: <><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 4.5v17M8 6h8M8 10h8" /></>,
    users: <><path d="M16 20v-1.7a3.3 3.3 0 0 0-3.3-3.3H6.3A3.3 3.3 0 0 0 3 18.3V20" /><circle cx="9.5" cy="7.5" r="3.5" /><path d="M17 11a3.5 3.5 0 0 0 0-7M21 20v-1.7a3.3 3.3 0 0 0-2.5-3.2" /></>,
    repeat: <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>,
    sliders: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="7" cy="18" r="2" fill="currentColor" stroke="none" /></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrowUp: <><path d="M17 13l-5-5-5 5M12 8v11" /></>,
    arrowDown: <><path d="M7 11l5 5 5-5M12 16V5" /></>,
    calendar: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
    filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    alert: <><path d="M10.3 3.8 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></>,
    close: <><path d="M6 6l12 12M18 6 6 18" /></>,
    edit: <path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5zM14 6.5l3.5 3.5" />,
    trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" /></>,
    chevron: <path d="m6 9 6 6 6-6" />,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    rotate: <><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" /><path d="M21 3v5h-5" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3.3 3.6-5 8-5s8 1.7 8 5" /></>,
    card: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h4" /></>,
    monitor: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>,
    barChart: <><path d="M4 20V10M10 20V4M16 20v-6M22 20V8" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  };
  return <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function StatusPill({ status }: { status: string }) {
  const style = status === "Terlambat" || status === "Nonaktif" ? "status-danger" : status === "Dikembalikan" || status === "Selesai" ? "status-success" : "status-warning";
  return <span className={`status-pill ${style}`}><span className="status-dot" />{status}</span>;
}

function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function StatCard({ icon, label, value, accent }: { icon: IconName; label: string; value: string; accent: string }) {
  return <div className="stat-card">
    <div className="stat-card-top"><span className={`stat-icon ${accent}`}><Icon name={icon} size={19} /></span></div>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
  </div>;
}

/* ---------- Book Cover (matches admin) ---------- */
function BookCover({ book, small = false }: { book: Pick<PortalBook, "initials" | "color" | "title" | "coverId" | "coverName">; small?: boolean }) {
  const [coverUrl, setCoverUrl] = useState("");
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  useEffect(() => {
    if (!thumbnailFailed || !book.coverId) return;
    let active = true;
    let objectUrl = "";
    loadBrowserFile(book.coverId).then((blob) => {
      if (!active || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setCoverUrl(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [book.coverId, thumbnailFailed]);

  const thumbnail = book.coverId ? api.coverThumbnailUrl(book.coverId, book.coverName ?? "cover") : "";
  return <div className={`book-cover ${small ? "book-cover-small" : ""}`} style={{ backgroundColor: book.color }}>
    {!thumbnailFailed && thumbnail ? <img src={thumbnail} alt={`Cover ${book.title}`} loading="lazy" decoding="async" onError={() => setThumbnailFailed(true)} /> : coverUrl ? <img src={coverUrl} alt={`Cover ${book.title}`} /> : <><span>{book.initials}</span><i>{book.title.split(" ")[0]}</i></>}
  </div>;
}

function EbookCover({ ebook }: { ebook: PortalEBook }) {
  const [coverUrl, setCoverUrl] = useState("");
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    if (thumbnailFailed && ebook.fileId && ebook.format === "PDF") {
      const cacheId = ebookCoverCacheId(ebook);
      loadBrowserFile(cacheId).then(async (cached) => {
        if (!active) return null;
        if (cached) { objectUrl = URL.createObjectURL(cached); return objectUrl; }
        const res = await api.downloadFile(ebook.fileId as string, { cache: "force-cache" }).catch(() => null);
        if (!active || !res) return null;
        const dataUrl = await getPdfCover(ebook.fileId as string, res);
        if (dataUrl) {
          const thumbnail = await dataUrlToBlob(dataUrl).catch(() => null);
          if (thumbnail) try {
            const db = await openFileDatabase();
            const tx = db.transaction(FILE_STORE_NAME, "readwrite");
            tx.objectStore(FILE_STORE_NAME).put({ id: cacheId, blob: thumbnail, compressed: false, originalType: thumbnail.type });
            db.close();
          } catch { /* ignore */ }
        }
        return dataUrl;
      }).then((dataUrl) => { if (active && dataUrl) setCoverUrl(dataUrl); }).catch(() => undefined);
    }
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [ebook.fileId, ebook.format, ebook.size, ebook.fileName, thumbnailFailed]);

  const thumbnail = ebook.fileId && ebook.format === "PDF"
    ? api.coverThumbnailUrl(ebook.fileId, `${ebook.size}:${ebook.fileName ?? ""}`)
    : "";
  if (!thumbnailFailed && thumbnail) {
    return <div className="book-cover ebook-cover-image"><img src={thumbnail} alt={`Cover ${ebook.title}`} loading="lazy" decoding="async" onError={() => setThumbnailFailed(true)} /></div>;
  }
  return coverUrl ? <div className="book-cover ebook-cover-image"><img src={coverUrl} alt={`Cover ${ebook.title}`} /></div> : <BookCover book={ebook} />;
}

/* ---------- Pagination ---------- */
const PAGE_SIZE = 9;
function CatalogPagination({ page, totalItems, onChange }: { page: number; totalItems: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(totalItems / PAGE_SIZE);
  if (totalPages <= 1) return null;
  return <nav className="catalog-pagination" aria-label="Navigasi halaman">
    <button type="button" className="catalog-page-arrow" disabled={page === 1} onClick={() => onChange(page - 1)}>‹ Sebelumnya</button>
    <div className="catalog-page-numbers">
      {Array.from({ length: totalPages }, (_, i) => <button key={i + 1} type="button" className={`catalog-page-number ${i + 1 === page ? "active" : ""}`} onClick={() => onChange(i + 1)}>{i + 1}</button>)}
    </div>
    <button type="button" className="catalog-page-arrow" disabled={page === totalPages} onClick={() => onChange(page + 1)}>Berikutnya ›</button>
  </nav>;
}

/* ---------- Confirm Modal ---------- */
function ConfirmDialog({ title, message, confirmLabel, danger, busy, onConfirm, onClose }: { title: string; message: string; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onClick={busy ? undefined : onClose}>
    <div className="modal confirm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
      <div className="modal-header"><div><span className="eyebrow">KONFIRMASI</span><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Tutup"><Icon name="close" size={20} /></button></div>
      <p className="confirm-message">{message}</p>
      <div className="modal-actions">
        <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>Batal</button>
        <button type="button" className={`button ${danger ? "button-danger" : "button-primary"}`} onClick={onConfirm} disabled={busy}>{busy ? "Memproses..." : confirmLabel ?? "Lanjutkan"}</button>
      </div>
    </div>
  </div>;
}

/* ====================== MEMBER PORTAL ====================== */
const memberNavItems: { key: MemberPage; label: string; icon: IconName }[] = [
  { key: "overview", label: "Ringkasan", icon: "grid" },
  { key: "ebooks", label: "Katalog E-Book", icon: "monitor" },
  { key: "books", label: "Katalog Buku", icon: "book" },
  { key: "loans", label: "Peminjaman", icon: "repeat" },
  { key: "reports", label: "Laporan", icon: "barChart" },
];

export default function MemberPortal({ memberCode, onLogout }: { memberCode: string; onLogout: () => void }) {
  const [activePage, setActivePage] = useState<MemberPage>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [member, setMember] = useState<PortalMember | null>(null);
  const [booksList, setBooksList] = useState<PortalBook[]>([]);
  const [ebooksList, setEbooksList] = useState<PortalEBook[]>([]);
  const [loansList, setLoansList] = useState<PortalLoan[]>([]);
  const [reservationsList, setReservationsList] = useState<PortalReservation[]>([]);

  // Settings
  const [avatarShape, setAvatarShape] = useState<"round" | "square">("round");
  const [themeMode, setThemeMode] = useState<ThemeMode>("auto");

  // Toast
  type Toast = { id: number; message: string; type: "error" | "success" | "info" };
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = (message: string, type: Toast["type"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  };

  // Profile
  const [profileDraft, setProfileDraft] = useState({ name: "", email: "", phone: "", bio: "" });
  const [avatarData, setAvatarData] = useState<string | undefined>(undefined);
  const [avatarName, setAvatarName] = useState<string | undefined>(undefined);
  const [avatarReading, setAvatarReading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [cropSource, setCropSource] = useState<string | null>(null);

  // Loan modal
  const [borrowModal, setBorrowModal] = useState<{ book: PortalBook } | null>(null);

  /* ---------- Load data ---------- */
  useEffect(() => {
    let active = true;
    Promise.all([
      api.fetchMembers(),
      api.fetchBooks(),
      api.fetchEbooks(),
      api.fetchLoans(),
      api.fetchReservations(),
    ]).then(([members, books, ebooks, loans, reservations]) => {
      if (!active) return;
      const found = members.find((m) => m.code === memberCode) ?? null;
      setMember(found);
      setBooksList(books);
      setEbooksList(ebooks);
      setLoansList(loans.filter((l) => l.memberCode === memberCode));
      setReservationsList(reservations.filter((r) => r.memberCode === memberCode));        if (found) {
        setProfileDraft({ name: found.name, email: found.email || "", phone: found.phone || "", bio: found.bio || "" });
        if (found.avatarData) setAvatarData(found.avatarData);
        if (found.avatarShape === "round" || found.avatarShape === "square") setAvatarShape(found.avatarShape);
        if (found.themeMode === "light" || found.themeMode === "dark" || found.themeMode === "auto") setThemeMode(found.themeMode);
      }
      setPrefsLoaded(true);
    }).catch(() => {
      if (active) setError("Data portal belum dapat dimuat. Silakan coba lagi.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [memberCode]);

  /* ---------- Dark mode ---------- */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (themeMode === "auto") {
        document.documentElement.classList.toggle("dark-mode", mql.matches);
      }
    };
    handler();
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark-mode", themeMode === "dark" || (themeMode === "auto" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches));
  }, [themeMode]);

  // Persist avatarShape to database when changed
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  useEffect(() => {
    if (!member || !prefsLoaded) return;
    void api.updateMember({ code: memberCode, avatarShape }).catch(() => undefined);
  }, [avatarShape]);

  // Persist themeMode to database when changed
  useEffect(() => {
    if (!member || !prefsLoaded) return;
    void api.updateMember({ code: memberCode, themeMode }).catch(() => undefined);
  }, [themeMode]);

  /* ---------- Derived ---------- */
  const displayMember = member ?? { name: "Anggota", code: memberCode, className: "Portal Anggota", initials: getInitials("Anggota"), color: "#cfe4da", role: "Siswa" as const, status: "Aktif" as const };
  const activeLoans = loansList.filter((l) => getLoanStatus(l) !== "Dikembalikan");
  const overdueLoans = loansList.filter((l) => getLoanStatus(l) === "Terlambat");
  const readyReservations = reservationsList.filter((r) => r.status === "Tersedia");
  const pageTitle = memberNavItems.find((n) => n.key === activePage)?.label ?? "Ringkasan";

  /* ---------- Actions ---------- */
  const navigate = (page: MemberPage) => { setActivePage(page); setSidebarOpen(false); };

  const handleBorrow = (book: PortalBook) => {
    setBorrowModal({ book });
  };

  const confirmBorrow = async (book: PortalBook) => {
    const newLoan: PortalLoan = {
      id: `loan-member-${Date.now()}`,
      member: displayMember.name,
      memberCode,
      book: book.title,
      bookCode: book.code,
      borrowed: formatDate(dateInputValue()),
      borrowedDate: dateInputValue(),
      due: formatDate(dateAfterDays(7)),
      dueDate: dateAfterDays(7),
      status: "Dipinjam",
      avatar: displayMember.initials,
      color: displayMember.color,
    };
    setLoansList((prev) => [...prev, newLoan]);
    setBooksList((prev) => prev.map((b) => b.code === book.code ? { ...b, available: Math.max(0, b.available - 1) } : b));
    await api.createLoan(newLoan).catch(() => {});
    await api.updateBook({ code: book.code, available: Math.max(0, book.available - 1) }).catch(() => {});
    addToast(`Berhasil meminjam "${book.title}".`, "success");
    setBorrowModal(null);
  };

  const saveProfile = async () => {
    try {
      let remoteAvatar = avatarData;
      // Upload new avatar (data URL) to Google Drive
      if (avatarData && avatarData.startsWith("data:")) {
        addToast("Mengunggah foto profil ke Drive...", "info");
        const blob = await dataUrlToBlob(avatarData);
        const fileId = `member-avatar:${memberCode}`;
        await api.uploadFile(fileId, blob, "avatar.jpg");
        remoteAvatar = api.fileUrl(fileId);
        setAvatarData(remoteAvatar);
      }
      const updates: { code: string; name?: string; email?: string; phone?: string; bio?: string; avatarData?: string } = {
        code: memberCode,
        name: profileDraft.name,
        email: profileDraft.email,
        phone: profileDraft.phone,
        bio: profileDraft.bio,
      };
      // Only update avatarData if it changed
      if (remoteAvatar !== (member?.avatarData ?? "")) {
        updates.avatarData = remoteAvatar;
      }
      // If avatar was removed, send empty string to clear it
      if (!avatarData && member?.avatarData) {
        updates.avatarData = "";
      }
      await api.updateMember(updates).catch(() => undefined);
      setMember((prev) => prev ? { ...prev, ...updates } : prev);
      addToast("Profil berhasil disimpan.", "success");
    } catch {
      addToast("Gagal menyimpan profil. Silakan coba lagi.", "error");
    }
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("File harus berupa gambar.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Ukuran foto maksimal 5 MB.");
      return;
    }
    setAvatarReading(true);
    setAvatarError("");
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (dataUrl) {
        setCropSource(dataUrl);
      } else {
        setAvatarError("Foto tidak dapat dibaca. Silakan pilih file lain.");
      }
      setAvatarReading(false);
    };
    reader.onerror = () => {
      setAvatarError("Foto tidak dapat dibaca. Silakan pilih file lain.");
      setAvatarReading(false);
    };
    reader.readAsDataURL(file);
  };

  const confirmCrop = (dataUrl: string) => {
    setAvatarData(dataUrl);
    setAvatarName("avatar-cropped.jpg");
    setCropSource(null);
  };

  const removeAvatar = () => {
    setAvatarData(undefined);
    setAvatarName(undefined);
    setAvatarError("");
  };

  const exportLoanHistory = () => {
    const header = "Judul Buku,Kode Buku,Tanggal Pinjam,Jatuh Tempo,Status\n";
    const rows = loansList.map((loan) => [loan.book, loan.bookCode, loan.borrowed, loan.due, getLoanStatus(loan)].map(csvCell).join(",")).join("\n");
    downloadTextFile(`riwayat-peminjaman-${memberCode}.csv`, `\ufeff${header}${rows}`, "text/csv;charset=utf-8");
  };

  /* ====================== RENDER ====================== */
  return <div className={`app-shell member-portal-shell avatar-shape-${avatarShape}`}>
    {/* ---- Sidebar ---- */}
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <div className="brand"><img src="/logo.png" alt="Al-Haytham Library" className="brand-logo" width="36" height="36" /><span>Al-Haytham <span className="brand-accent">Library</span></span></div>
      <div className="sidebar-label">MENU ANGGOTA</div>
      <nav>{memberNavItems.map((item) => <button key={item.key} className={`nav-item ${activePage === item.key ? "active" : ""}`} onClick={() => navigate(item.key)}><Icon name={item.icon} size={19} /><span>{item.label}</span></button>)}</nav>
      <div className="sidebar-label sidebar-secondary">LAINNYA</div>
      <nav>
        <button className={`nav-item ${activePage === "settings" ? "active" : ""}`} onClick={() => navigate("settings")}><Icon name="sliders" size={19} /><span>Pengaturan</span></button>
      </nav>
      <div className="sidebar-bottom">
        <button className="user-card" onClick={() => navigate("settings")} aria-label="Profil akun">
          <span className="avatar user-avatar" style={{ backgroundColor: displayMember.color }}>{avatarData ? <img key={avatarData} src={avatarData} alt="Foto profil" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : displayMember.initials}</span>
          <span><b>{displayMember.name}</b><small>{displayMember.code}</small></span>
        </button>
        <button className="nav-item" style={{ marginTop: 10, color: "#b07a74" }} onClick={onLogout}><Icon name="logout" size={19} /><span>Keluar</span></button>
      </div>
    </aside>

    {/* ---- Main Content ---- */}
    <main className="main-content">
      <header className="topbar">
        <button className="mobile-menu icon-button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Buka menu"><Icon name="menu" size={21} /></button>
        <div className="breadcrumb"><span>Al-Haytham Library</span><b>/</b><strong>{pageTitle}</strong></div>
        <div className="topbar-actions">
          <button className="top-avatar" style={{ backgroundColor: displayMember.color }} onClick={() => navigate("settings")} aria-label="Profil">{avatarData ? <img key={avatarData} src={avatarData} alt="Foto profil" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} /> : displayMember.initials}</button>
        </div>
      </header>

      {loading && <div className="page-content"><div className="empty-state"><h3>Memuat portal anggota...</h3></div></div>}
      {error && <div className="page-content"><div className="form-error"><Icon name="alert" size={16} /> {error}</div></div>}

      {!loading && !error && <div className="page-content">

        {/* ===== RINGKASAN ===== */}
        {activePage === "overview" && <>
          <PageHeader title={`Selamat datang, ${displayMember.name.split(" ")[0]}`} description="Berikut ringkasan aktivitas perpustakaan Anda." />
          <div className="stat-grid">
            <StatCard icon="repeat" label="Peminjaman aktif" value={String(activeLoans.length)} accent="orange" />
            <StatCard icon="book" label="Buku tersedia" value={String(booksList.filter((b) => b.available > 0).length)} accent="green" />
            <StatCard icon="monitor" label="E-Book tersedia" value={String(ebooksList.length)} accent="blue" />
            <StatCard icon="clock" label="Reservasi siap" value={String(readyReservations.length)} accent="red" />
          </div>

          <div className="dashboard-grid">
            <section className="panel activity-panel">
              <div className="panel-heading"><div><h2>Peminjaman aktif</h2><p>Daftar buku yang sedang Anda pinjam</p></div><button className="text-button" onClick={() => navigate("loans")}>Lihat semua</button></div>
              <div className="table-scroll">
                <table><thead><tr><th>Peminjam</th><th>Buku</th><th>Tanggal pinjam</th><th>Jatuh tempo</th><th>Status</th></tr></thead>
                <tbody>{activeLoans.length > 0 ? activeLoans.map((loan) => <tr key={loan.id}><td><div className="person"><span className="avatar" style={{ backgroundColor: displayMember.color }}>{avatarData ? <img src={avatarData} alt="Foto profil" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : displayMember.initials}</span><span><b>{loan.member || "Anda"}</b></span></div></td><td>{loan.book}</td><td>{loan.borrowed}</td><td className={getLoanStatus(loan) === "Terlambat" ? "late-text" : ""}>{loan.due}</td><td><StatusPill status={getLoanStatus(loan)} /></td></tr>) : <tr><td colSpan={5} style={{ textAlign: "center", color: "#9aa59f", fontSize: 12, padding: 20 }}>Belum ada peminjaman aktif</td></tr>}</tbody></table>
              </div>
            </section>
            <section className="panel attention-panel">
              <div className="panel-heading"><div><h2>E-Book terbaru</h2><p>Baca langsung dari perangkat Anda</p></div><button className="text-button" onClick={() => navigate("ebooks")}>Lihat semua</button></div>
              <div style={{ display: "grid", gap: 10 }}>
                {ebooksList.slice(0, 3).map((ebook) => <div key={ebook.code} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0" }}>
                  <div style={{ width: 44, height: 56, borderRadius: 6, backgroundColor: ebook.color, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, color: "#38705d", flexShrink: 0, overflow: "hidden" }}>
                    {ebook.fileId && ebook.format === "PDF" ? <img src={api.coverThumbnailUrl(ebook.fileId, `${ebook.size}:${ebook.fileName ?? ""}`)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" decoding="async" /> : ebook.initials}
                  </div>
                  <div style={{ minWidth: 0 }}><b style={{ fontSize: 11, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ebook.title}</b><span style={{ fontSize: 10, color: "#82958b" }}>{ebook.author}</span></div>
                </div>)}
              </div>
            </section>
          </div>
        </>}

        {/* ===== KATALOG E-BOOK ===== */}
        {activePage === "ebooks" && <EbooksCatalog ebooks={ebooksList} onRead={(ebook) => { if (ebook.fileId) window.open(fileLink(ebook.fileId), "_blank"); }} />}

        {/* ===== KATALOG BUKU ===== */}
        {activePage === "books" && <BooksCatalog books={booksList} onBorrow={handleBorrow} activeLoans={activeLoans} memberCode={memberCode} />}

        {/* ===== PEMINJAMAN ===== */}
        {activePage === "loans" && <LoansPage loans={loansList} onBorrow={() => navigate("books")} avatarData={avatarData} memberInitials={displayMember.initials} memberColor={displayMember.color} />}

        {/* ===== LAPORAN ===== */}
        {activePage === "reports" && <ReportsPage loans={loansList} books={booksList} memberName={displayMember.name} onExport={exportLoanHistory} avatarData={avatarData} memberInitials={displayMember.initials} memberColor={displayMember.color} />}

        {/* ===== PENGATURAN ===== */}
        {activePage === "settings" && <SettingsPage member={displayMember} draft={profileDraft} onDraftChange={setProfileDraft} onSave={saveProfile} avatarData={avatarData} avatarReading={avatarReading} avatarError={avatarError} onAvatarChange={handleAvatarChange} onAvatarRemove={removeAvatar} avatarShape={avatarShape} onAvatarShapeChange={setAvatarShape} themeMode={themeMode} onThemeModeChange={setThemeMode} />}
      </div>}

      {/* ---- Toasts ---- */}
      <div className="toast-container" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast toast-${t.type}`} onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}><span className="toast-icon">{t.type === "error" ? "❌" : t.type === "success" ? "✅" : "ℹ️"}</span><span className="toast-message">{t.message}</span></div>)}</div>

      {/* ---- Borrow Modal ---- */}
      {borrowModal && <ConfirmDialog title="Pinjam buku" message={`Pinjam "${borrowModal.book.title}" selama 7 hari?`} confirmLabel="Pinjam" onConfirm={() => confirmBorrow(borrowModal.book)} onClose={() => setBorrowModal(null)} />}

      {/* ---- Avatar Crop Modal ---- */}
      {cropSource && <AvatarCropModal imageUrl={cropSource} preview={{ name: profileDraft.name || displayMember.name, role: "Anggota", detail: `${displayMember.code} · ${displayMember.className}`, color: displayMember.color }} onCancel={() => setCropSource(null)} onConfirm={confirmCrop} />}
    </main>
  </div>;
}

/* ---------- Avatar Crop Modal ---------- */
function AvatarCropModal({ imageUrl, preview, onCancel, onConfirm }: { imageUrl: string; preview?: { name: string; role: string; detail: string; color: string }; onCancel: () => void; onConfirm: (dataUrl: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [source, setSource] = useState(imageUrl);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const CONTAINER = 280;

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  const bounds = (nextZoom: number) => {
    const img = imgRef.current;
    if (!img) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    const baseScale = Math.max(CONTAINER / img.naturalWidth, CONTAINER / img.naturalHeight);
    const scale = baseScale * nextZoom;
    return { minX: CONTAINER - img.naturalWidth * scale, maxX: 0, minY: CONTAINER - img.naturalHeight * scale, maxY: 0 };
  };

  const center = (nextZoom: number) => {
    const b = bounds(nextZoom);
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  };

  const handleLoad = () => {
    setReady(true);
    setPos(center(zoom));
  };

  const rotateClockwise = () => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    setSource(canvas.toDataURL("image/png"));
    setReady(false);
  };

  const buildCropped = (size: number) => {
    const img = imgRef.current;
    if (!img) return null;
    const baseScale = Math.max(CONTAINER / img.naturalWidth, CONTAINER / img.naturalHeight);
    const scale = baseScale * zoom;
    const srcSize = CONTAINER / scale;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, -pos.x / scale, -pos.y / scale, srcSize, srcSize, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.9);
  };

  useEffect(() => {
    if (!ready) return;
    const url = buildCropped(96);
    setPreviewUrl(url);
  }, [zoom, pos, ready, source]);

  const changeZoom = (nextZoom: number) => {
    const clamped = clamp(nextZoom, 1, 3);
    const img = imgRef.current;
    if (img) {
      const baseScale = Math.max(CONTAINER / img.naturalWidth, CONTAINER / img.naturalHeight);
      const prevScale = baseScale * zoom;
      const nextScale = baseScale * clamped;
      const centerX = (CONTAINER / 2 - pos.x) / prevScale;
      const centerY = (CONTAINER / 2 - pos.y) / prevScale;
      const b = bounds(clamped);
      setPos({ x: clamp(CONTAINER / 2 - centerX * nextScale, b.minX, b.maxX), y: clamp(CONTAINER / 2 - centerY * nextScale, b.minY, b.maxY) });
    }
    setZoom(clamped);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: pos.x, originY: pos.y };
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const b = bounds(zoom);
    setPos({ x: clamp(drag.originX + (event.clientX - drag.startX), b.minX, b.maxX), y: clamp(drag.originY + (event.clientY - drag.startY), b.minY, b.maxY) });
  };

  const onPointerUp = () => { dragRef.current = null; };

  const apply = () => {
    const url = buildCropped(256);
    if (url) onConfirm(url);
  };

  const img = imgRef.current;
  const baseScale = img ? Math.max(CONTAINER / img.naturalWidth, CONTAINER / img.naturalHeight) : 1;
  const scale = baseScale * zoom;
  const displayStyle = img ? { width: img.naturalWidth * scale, height: img.naturalHeight * scale, transform: `translate(${pos.x}px, ${pos.y}px)` } : {};

  return <div className="modal-backdrop crop-backdrop" role="presentation" onClick={onCancel}><div className="modal crop-modal" role="dialog" aria-modal="true" aria-labelledby="crop-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">ATUR FOTO</span><h2 id="crop-title">Potong foto</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Tutup"><Icon name="close" size={20} /></button></div><div className="crop-layout"><div className="crop-left"><div className="crop-stage" ref={containerRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}><img ref={imgRef} src={source} alt="Pratinjau foto untuk dipotong" draggable={false} onLoad={handleLoad} style={displayStyle} /></div><div className="crop-zoom"><span>Perbesar</span><input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} /><span>{Math.round(zoom * 100)}%</span><button type="button" className="crop-rotate" onClick={rotateClockwise} disabled={!ready} aria-label="Putar foto 90 derajat" title="Putar 90°"><Icon name="rotate" size={15} /> Putar</button></div></div>{preview && <div className="crop-right"><span className="crop-preview-label">Pratinjau foto profil</span><div className="crop-card"><div className="crop-card-top">Al-Haytham Library · Profil Anggota</div><div className="crop-card-body"><span className="crop-card-avatar" style={{ backgroundColor: preview.color }}>{previewUrl ? <img src={previewUrl} alt="Pratinjau foto hasil potong" /> : getInitials(preview.name)}</span><div className="crop-card-details"><b>{preview.name || "Nama anggota"}</b><span>{preview.role}</span><small>{preview.detail}</small></div></div></div></div>}</div><p className="crop-hint">Geser foto untuk mengatur posisi, gunakan penggeser untuk memperbesar.</p><div className="modal-actions"><button type="button" className="button button-outline" onClick={onCancel}>Batal</button><button type="button" className="button button-primary" onClick={apply}>Terapkan</button></div></div></div>;
}

/* ====================== SUB-PAGES ====================== */

function EbooksCatalog({ ebooks, onRead }: { ebooks: PortalEBook[]; onRead: (ebook: PortalEBook) => void }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const categories = useMemo(() => [...new Set(ebooks.map((e) => e.category))].sort(), [ebooks]);

  const filtered = useMemo(() => ebooks.filter((e) => {
    const matchesSearch = `${e.title} ${e.author} ${e.category}`.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || e.category === categoryFilter;
    return matchesSearch && matchesCategory;
  }), [search, ebooks, categoryFilter]);

  useEffect(() => { setCurrentPage(1); }, [search, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return <>
    <PageHeader title="Katalog E-Book" description="Jelajahi koleksi digital yang tersedia untuk dibaca." />
    <div className="toolbar">
      <label className="search-box"><Icon name="search" size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari judul, penulis, atau kategori..." /></label>
      <div className="filter-control">
        <button className={`button button-outline ${categoryFilter ? "filter-active" : ""}`} onClick={() => setFilterOpen((o) => !o)}><Icon name="filter" size={16} /> Filter{categoryFilter ? <span className="filter-count">1</span> : ""}</button>
        {filterOpen && <div className="filter-panel" role="dialog"><div className="filter-panel-header"><strong>Filter E-Book</strong><button type="button" className="text-button" onClick={() => { setCategoryFilter(""); setFilterOpen(false); }}>Reset</button></div>
          <label className="filter-field">Kategori<select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="">Semua kategori</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <button type="button" className="button button-primary filter-done" onClick={() => setFilterOpen(false)}>Terapkan</button>
        </div>}
      </div>
    </div>
    <div className="book-grid">{paginated.map((ebook) => <article className="book-card" key={ebook.code}>
      <div className="book-card-cover">
        <EbookCover ebook={ebook} />
        <span className="stock-label">{ebook.format}</span>
      </div>
      <div className="book-card-body">
        <div className="book-category">{ebook.category}</div>
        <h3>{ebook.title}</h3>
        <p>{ebook.author}</p>
        <div className="book-meta"><span>{ebook.code}</span></div>
        {ebook.fileId && <button className="button button-primary" style={{ fontSize: 11, padding: "5px 12px", minHeight: 30, width: "100%", marginTop: 8 }} onClick={() => onRead(ebook)}><Icon name="book" size={14} /> Baca E-Book</button>}
      </div>
    </article>)}</div>
    <CatalogPagination page={currentPage} totalItems={filtered.length} onChange={setCurrentPage} />
    {filtered.length === 0 && <div className="empty-state"><Icon name="search" size={30} /><h3>E-Book tidak ditemukan</h3><p>Coba gunakan kata kunci pencarian lain.</p></div>}
  </>;
}

function BooksCatalog({ books, onBorrow, activeLoans, memberCode }: { books: PortalBook[]; onBorrow: (book: PortalBook) => void; activeLoans: PortalLoan[]; memberCode: string }) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const categories = useMemo(() => [...new Set(books.map((b) => b.category))].sort(), [books]);

  const filtered = useMemo(() => books.filter((b) => {
    const matchesSearch = `${b.title} ${b.author} ${b.category}`.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || b.category === categoryFilter;
    const matchesAvailability = !availabilityFilter || (availabilityFilter === "available" ? b.available > 0 : b.available === 0);
    return matchesSearch && matchesCategory && matchesAvailability;
  }), [search, books, categoryFilter, availabilityFilter]);

  useEffect(() => { setCurrentPage(1); }, [search, categoryFilter, availabilityFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const borrowedBookCodes = new Set(activeLoans.filter((l) => l.memberCode === memberCode && getLoanStatus(l) !== "Dikembalikan").map((l) => l.bookCode));

  return <>
    <PageHeader title="Katalog Buku" description="Telusuri koleksi buku perpustakaan dan pinjam yang Anda inginkan." />
    <div className="toolbar">
      <label className="search-box"><Icon name="search" size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari judul, penulis, atau kategori..." /></label>
      <div className="filter-control">
        <button className={`button button-outline ${(categoryFilter || availabilityFilter) ? "filter-active" : ""}`} onClick={() => setFilterOpen((o) => !o)}><Icon name="filter" size={16} /> Filter{(categoryFilter || availabilityFilter) ? <span className="filter-count">{Number(Boolean(categoryFilter)) + Number(Boolean(availabilityFilter))}</span> : ""}</button>
        {filterOpen && <div className="filter-panel" role="dialog"><div className="filter-panel-header"><strong>Filter Buku</strong><button type="button" className="text-button" onClick={() => { setCategoryFilter(""); setAvailabilityFilter(""); }}>Reset</button></div>
          <label className="filter-field">Kategori<select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="">Semua kategori</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label className="filter-field">Ketersediaan<select value={availabilityFilter} onChange={(e) => setAvailabilityFilter(e.target.value)}><option value="">Semua status</option><option value="available">Tersedia</option><option value="out">Habis dipinjam</option></select></label>
          <button type="button" className="button button-primary filter-done" onClick={() => setFilterOpen(false)}>Terapkan</button>
        </div>}
      </div>
    </div>
    <div className="book-grid">{paginated.map((book) => {
      const isBorrowed = borrowedBookCodes.has(book.code);
      return <article className="book-card" key={book.code}>
        <div className="book-card-cover">
          <BookCover book={book} />
          <span className={`stock-label ${book.available === 0 ? "out" : ""}`}>{book.available === 0 ? "Habis dipinjam" : `${book.available} tersedia`}</span>
        </div>
        <div className="book-card-body">
          <div className="book-category">{book.category}</div>
          <h3>{book.title}</h3>
          <p>{book.author}</p>
          <div className="book-meta"><span>{book.code}</span></div>
          {book.available > 0 && !isBorrowed && <button className="button button-primary" style={{ fontSize: 11, padding: "5px 12px", minHeight: 30, width: "100%", marginTop: 8 }} onClick={() => onBorrow(book)}><Icon name="repeat" size={14} /> Pinjam buku</button>}
          {isBorrowed && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--green)", fontWeight: 600, marginTop: 8 }}><Icon name="check" size={13} /> Sedang dipinjam</span>}
        </div>
      </article>;
    })}</div>
    <CatalogPagination page={currentPage} totalItems={filtered.length} onChange={setCurrentPage} />
    {filtered.length === 0 && <div className="empty-state"><Icon name="search" size={30} /><h3>Buku tidak ditemukan</h3><p>Coba gunakan kata kunci pencarian lain.</p></div>}
  </>;
}

function LoansPage({ loans, onBorrow, avatarData, memberInitials, memberColor }: { loans: PortalLoan[]; onBorrow: () => void; avatarData?: string; memberInitials: string; memberColor: string }) {
  const [tab, setTab] = useState("Semua");
  const tabs = ["Semua", "Dipinjam", "Terlambat", "Dikembalikan"];
  const filtered = loans.filter((l) => tab === "Semua" || getLoanStatus(l) === tab);
  const activeCount = loans.filter((l) => getLoanStatus(l) === "Dipinjam").length;
  const overdueCount = loans.filter((l) => getLoanStatus(l) === "Terlambat").length;
  const returnedCount = loans.filter((l) => getLoanStatus(l) === "Dikembalikan").length;

  return <>
    <PageHeader title="Peminjaman" description="Lihat riwayat peminjaman dan pengembalian buku Anda." />
    <div className="summary-strip">
      <div><span className="mini-icon orange"><Icon name="repeat" size={16} /></span><span><b>{activeCount}</b><small>Sedang dipinjam</small></span></div>
      <div><span className="mini-icon red"><Icon name="clock" size={16} /></span><span><b>{overdueCount}</b><small>Terlambat</small></span></div>
      <div><span className="mini-icon green"><Icon name="check" size={16} /></span><span><b>{returnedCount}</b><small>Dikembalikan</small></span></div>
    </div>
    <section className="panel full-table-panel">
      <div className="loan-toolbar">
        <div className="tabs">{tabs.map((t) => <button key={t} onClick={() => setTab(t)} className={`tab ${tab === t ? "active" : ""}`}>{t}</button>)}</div>
      </div>
      <div className="table-scroll">
        <table><thead><tr><th>Peminjam</th><th>Judul buku</th><th>Tanggal pinjam</th><th>Jatuh tempo</th><th>Status</th></tr></thead>
        <tbody>{filtered.map((loan) => <tr key={loan.id}><td><div className="person"><span className="avatar" style={{ backgroundColor: memberColor }}>{avatarData ? <img src={avatarData} alt="Foto profil" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : memberInitials}</span><span><b>{loan.member || "Anda"}</b></span></div></td><td>{loan.book}</td><td>{loan.borrowed}</td><td className={getLoanStatus(loan) === "Terlambat" ? "late-text" : ""}>{loan.due}</td><td><StatusPill status={getLoanStatus(loan)} /></td></tr>)}</tbody></table>
      </div>
      {filtered.length === 0 && <div className="empty-state member-empty"><Icon name="repeat" size={30} /><h3>Belum ada riwayat peminjaman</h3><p>Silakan kunjungi katalog buku untuk meminjam.</p><button className="button button-primary" onClick={onBorrow} style={{ marginTop: 10 }}><Icon name="book" size={14} /> Lihat Katalog Buku</button></div>}
    </section>
  </>;
}

function ReportsPage({ loans, books, memberName, onExport, avatarData, memberInitials, memberColor }: { loans: PortalLoan[]; books: PortalBook[]; memberName: string; onExport: () => void; avatarData?: string; memberInitials: string; memberColor: string }) {
  const totalLoans = loans.length;
  const activeLoans = loans.filter((l) => getLoanStatus(l) === "Dipinjam").length;
  const overdueLoans = loans.filter((l) => getLoanStatus(l) === "Terlambat").length;
  const returnedLoans = loans.filter((l) => getLoanStatus(l) === "Dikembalikan").length;
  const uniqueBooks = new Set(loans.map((l) => l.bookCode)).size;

  // Fine calculation: 1000 per day overdue
  const today = dateInputValue();
  const totalFines = loans.filter((l) => getLoanStatus(l) === "Terlambat").reduce((sum, l) => {
    const due = l.dueDate ?? "";
    if (!due) return sum;
    const days = Math.max(0, Math.ceil((new Date(today).getTime() - new Date(due).getTime()) / 86400000));
    return sum + days * 1000;
  }, 0);

  const statusData = [
    { label: "Dipinjam", count: activeLoans, color: "green" },
    { label: "Terlambat", count: overdueLoans, color: "orange" },
    { label: "Dikembalikan", count: returnedLoans, color: "blue" },
  ];
  const maxStatus = Math.max(...statusData.map((s) => s.count), 1);

  return <>
    <PageHeader title="Laporan" description={`Riwayat peminjaman ${memberName}.`} action={<button className="button button-outline" onClick={onExport}><Icon name="download" size={16} /> Export CSV</button>} />
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, padding: "10px 14px", background: "#f1f7f3", borderRadius: 8, fontSize: 12 }}><span className="avatar" style={{ backgroundColor: memberColor, width: 32, height: 32, fontSize: 12, flexShrink: 0 }}>{avatarData ? <img src={avatarData} alt="Foto profil" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : memberInitials}</span><span><b>{memberName}</b><small style={{ display: "block", color: "#729082" }}>Semua data peminjaman pribadi</small></span></div>
    <div className="stat-grid">
      <StatCard icon="repeat" label="Total transaksi" value={String(totalLoans)} accent="green" />
      <StatCard icon="book" label="Buku berbeda" value={String(uniqueBooks)} accent="blue" />
      <StatCard icon="check" label="Dikembalikan" value={String(returnedLoans)} accent="green" />
      <StatCard icon="alert" label="Denda terutang" value={`Rp ${totalFines.toLocaleString("id-ID")}`} accent="red" />
    </div>
    <div className="reports-grid">
      <section className="panel">
        <div className="panel-heading"><div><h2>Distribusi status peminjaman</h2></div></div>
        <div className="reports-bar-chart">
          {statusData.map((item) => <div className="reports-bar-row" key={item.label}>
            <span className="reports-bar-label">{item.label}</span>
            <div className="reports-bar-track"><div className={`reports-bar-fill ${item.color}`} style={{ width: `${Math.max(8, (item.count / maxStatus) * 100)}%` }} /></div>
            <span className="reports-bar-value"><strong>{item.count}</strong> transaksi</span>
          </div>)}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading"><div><h2>Riwayat peminjaman</h2><p>Semua transaksi peminjaman Anda</p></div></div>
        <div className="table-scroll">
          <table><thead><tr><th>Peminjam</th><th>Buku</th><th>Tanggal pinjam</th><th>Jatuh tempo</th><th>Status</th></tr></thead>
          <tbody>{loans.map((loan) => <tr key={loan.id}><td><div className="person"><span className="avatar" style={{ backgroundColor: memberColor }}>{avatarData ? <img src={avatarData} alt="Foto profil" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : memberInitials}</span><span><b>{loan.member || "Anda"}</b></span></div></td><td>{loan.book}</td><td>{loan.borrowed}</td><td className={getLoanStatus(loan) === "Terlambat" ? "late-text" : ""}>{loan.due}</td><td><StatusPill status={getLoanStatus(loan)} /></td></tr>)}</tbody></table>
        </div>
        {loans.length === 0 && <div className="empty-state member-empty"><Icon name="barChart" size={30} /><h3>Belum ada data</h3><p>Riwayat peminjaman akan muncul di sini.</p></div>}
      </section>
    </div>
  </>;
}

function SettingsPage({ member, draft, onDraftChange, onSave, avatarData, avatarReading, avatarError, onAvatarChange, onAvatarRemove, avatarShape, onAvatarShapeChange, themeMode, onThemeModeChange }: { member: { name: string; code: string; className: string; initials: string; color: string }; draft: { name: string; email: string; phone: string; bio: string }; onDraftChange: (d: { name: string; email: string; phone: string; bio: string }) => void; onSave: () => void; avatarData?: string; avatarReading: boolean; avatarError: string; onAvatarChange: (e: React.ChangeEvent<HTMLInputElement>) => void; onAvatarRemove: () => void; avatarShape: "round" | "square"; onAvatarShapeChange: (s: "round" | "square") => void; themeMode: ThemeMode; onThemeModeChange: (m: ThemeMode) => void }) {
  const [saved, setSaved] = useState(false);

  const save = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return <>
    <PageHeader title="Pengaturan" description="Kelola profil, tampilan, dan preferensi portal anggota Anda." />
    <div className="settings-grid">
      {/* ---- Profil Akun ---- */}
      <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>Profil akun</h2><p>Informasi profil dan foto anggota Anda.</p></div></div>
        <div className="profile-identity" style={{ marginBottom: 18 }}>
          <span className="profile-avatar-large" style={{ backgroundColor: member.color }}>
            {avatarData ? <img key={avatarData} src={avatarData} alt="Foto profil" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit", display: "block" }} /> : member.initials}
          </span>
          <div>
            <strong>{member.name}</strong>
            <small>{member.code} · {member.className}</small>
            <div className="avatar-actions" style={{ marginTop: 6 }}>
              <label className="avatar-upload-label">
                <input className="file-input" type="file" accept="image/*" onChange={onAvatarChange} />
                <span className="text-button avatar-upload-button"><Icon name="upload" size={13} />{avatarReading ? "Memproses..." : avatarData ? "Ganti foto" : "Upload foto"}</span>
              </label>
              {avatarData && <button type="button" className="text-button avatar-remove-button" onClick={onAvatarRemove}>Hapus foto</button>}
            </div>
          </div>
        </div>
        {avatarError && <div className="form-error"><Icon name="alert" size={16} />{avatarError}</div>}
        <div className="form-grid settings-form">
          <label>Nama lengkap<input value={member.name} readOnly disabled style={{ opacity: 0.65, cursor: "not-allowed" }} title="Nama diatur oleh administrator" /></label>
          <label>Email<input type="email" value={draft.email} onChange={(e) => onDraftChange({ ...draft, email: e.target.value })} placeholder="email@contoh.id" /></label>
          <label>Nomor telepon<input value={draft.phone} onChange={(e) => onDraftChange({ ...draft, phone: e.target.value })} placeholder="0812 3456 7890" /></label>
          <label className="form-span">Bio singkat<textarea value={draft.bio} onChange={(e) => onDraftChange({ ...draft, bio: e.target.value })} placeholder="Ceritakan sedikit tentang diri Anda..." rows={3} style={{ width: "100%", border: "1px solid #dce6e1", borderRadius: 7, padding: 10, fontSize: 11, fontFamily: "inherit", resize: "vertical" }} /></label>
        </div>
        <div style={{ marginTop: 14 }}><button className="button button-primary" onClick={() => { onSave(); save(); }}><Icon name="check" size={15} /> Simpan profil</button></div>
      </section>

      {/* ---- Pengaturan Tampilan ---- */}
      <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>Pengaturan tampilan</h2><p>Pilih bentuk avatar untuk foto profil Anda.</p></div></div>
        <div className="avatar-shape-options">
          <button type="button" className={`avatar-shape-option ${avatarShape === "round" ? "active" : ""}`} onClick={() => { onAvatarShapeChange("round"); save(); }}>
            <span className="avatar-shape-demo round"><span>AG</span></span><span><b>Bulat</b><small>Bentuk avatar lingkaran penuh</small></span>
          </button>
          <button type="button" className={`avatar-shape-option ${avatarShape === "square" ? "active" : ""}`} onClick={() => { onAvatarShapeChange("square"); save(); }}>
            <span className="avatar-shape-demo square"><span>AG</span></span><span><b>Persegi</b><small>Sudut membulat, tampilan modern</small></span>
          </button>
        </div>
      </section>

      {/* ---- Tema ---- */}
      <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>Tema tampilan</h2><p>Pilih tema terang, gelap, atau ikuti pengaturan perangkat.</p></div></div>
        <div className="avatar-shape-options">
          <button type="button" className={`theme-option ${themeMode === "auto" ? "active" : ""}`} onClick={() => { onThemeModeChange("auto"); save(); }}>
            <span className="theme-option-demo demo-auto" /><span><b>Otomatis</b><small>Ikuti pengaturan terang/gelap perangkat</small></span>
          </button>
          <button type="button" className={`theme-option ${themeMode === "light" ? "active" : ""}`} onClick={() => { onThemeModeChange("light"); save(); }}>
            <span className="theme-option-demo demo-light" /><span><b>Terang</b><small>Tampilan default dengan latar cerah</small></span>
          </button>
          <button type="button" className={`theme-option ${themeMode === "dark" ? "active" : ""}`} onClick={() => { onThemeModeChange("dark"); save(); }}>
            <span className="theme-option-demo demo-dark" /><span><b>Gelap</b><small>Mata lebih nyaman di ruangan minim cahaya</small></span>
          </button>
        </div>
      </section>

      {/* ---- Informasi Keanggotaan ---- */}
      <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>Informasi anggota</h2><p>Detail keanggotaan Anda di perpustakaan.</p></div></div>
        <div style={{ display: "grid", gap: 12, fontSize: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #edf1ef" }}><span style={{ color: "#82958b" }}>Kode anggota</span><b>{member.code}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #edf1ef" }}><span style={{ color: "#82958b" }}>Kelas</span><b>{member.className}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}><span style={{ color: "#82958b" }}>Status</span><StatusPill status="Aktif" /></div>
        </div>
      </section>
    </div>
    <div className="settings-actions"><span className={saved ? "settings-saved" : "settings-saved hidden"}>Perubahan tersimpan.</span></div>
  </>;
}
