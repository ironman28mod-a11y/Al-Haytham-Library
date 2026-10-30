"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type * as pdfjsLib from "pdfjs-dist";
import * as api from "../lib/api";

type IconName =
  | "grid"
  | "book"
  | "users"
  | "repeat"
  | "sliders"
  | "logout"
  | "search"
  | "bell"
  | "plus"
  | "arrowUp"
  | "arrowDown"
  | "calendar"
  | "filter"
  | "download"
  | "upload"
  | "clock"
  | "check"
  | "alert"
  | "close"
  | "edit"
  | "trash"
  | "chevron"
  | "more"
  | "menu"
  | "monitor"
  | "rotate"
  | "user"
  | "card"
  | "barChart";

type PageKey = "overview" | "ebooks" | "books" | "members" | "loans" | "reports" | "reservations" | "settings";
type ThemeMode = "auto" | "light" | "dark";
type ProfileRole = "staff" | "student";
type ProfileData = { name: string; email: string; phone: string; bio: string; role: ProfileRole; detail: string; avatarData?: string; avatarName?: string };

function getInitials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "AU";
}

/** Kode buku berikutnya: BK- + nomor terbesar pada daftar + 1 (rapat 5 digit). */
function nextBookCodeFrom(list: Pick<Book, "code">[]) {
  const max = list.reduce((current, book) => Math.max(current, Number(book.code.replace(/\D/g, "")) || 0), 0);
  return `BK-${String(max + 1).padStart(5, "0")}`;
}

type Book = {
  title: string;
  author: string;
  category: string;
  code: string;
  stock: number;
  available: number;
  color: string;
  initials: string;
  coverId?: string;
  coverName?: string;
  coverData?: string;
};

type EBook = Book & { format: string; size: string; access: string; fileName?: string; fileId?: string };
type TocEntry = { title: string; pageIndex: number | null; children: TocEntry[] };
type PdfOutlineNode = { title: string; dest: string | Array<unknown> | null; items: PdfOutlineNode[] };
type BrowserFileRecord = { id: string; blob: Blob; compressed: boolean; originalType: string };

const EBOOK_STORAGE_KEY = "al-haytham-library:ebooks:v1";
const BOOK_STORAGE_KEY = "al-haytham-library:books:v1";
const CATEGORY_STORAGE_KEY = "al-haytham-library:categories:v1";
const PROFILE_STORAGE_KEY = "al-haytham-library:profile:v1";
const MEMBERS_STORAGE_KEY = "al-haytham-library:members:v1";
const CLASSES_STORAGE_KEY = "al-haytham-library:classes:v1";
const LOANS_STORAGE_KEY = "al-haytham-library:loans:v1";
const AVATAR_SHAPE_STORAGE_KEY = "al-haytham-library:avatar-shape:v1";
const READING_PROGRESS_STORAGE_KEY = "al-haytham-library:reading-progress:v1";
const DARK_MODE_STORAGE_KEY = "al-haytham-library:dark-mode:v1";
const FILE_DB_NAME = "al-haytham-library-files";
const FILE_STORE_NAME = "files";
const SUPPORTED_EBOOK_FORMATS = ["PDF", "EPUB", "MOBI"] as const;

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

async function compressImageFile(file: File, maxDimension = 1600, quality = 0.82) {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\\.[^.]+$/, "")}.webp`, { type: "image/webp", lastModified: Date.now() });
  } catch {
    return file;
  }
}

async function dataUrlToBlob(dataUrl: string) {
  return (await fetch(dataUrl)).blob();
}

async function storeLibraryFile(id: string, file: File, compressLocal = false, replaceExisting = true, onProgress?: (percent: number) => void) {
  const optimized = file.type.startsWith("image/") ? await compressImageFile(file) : file;
  // Upload first so metadata is never created for a file that only exists locally.
  if (id.startsWith("ebook:")) {
    await api.uploadFileResumable(id, optimized, file.name, { replaceExisting }, onProgress);
  } else {
    await api.uploadFile(id, optimized, file.name, { replaceExisting });
  }
  await saveBrowserFile(id, optimized, compressLocal && !optimized.type.startsWith("image/"));
  return optimized;
}

async function moveAvatarToRemote(id: string, dataUrl?: string) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl;
  await api.uploadFile(id, await dataUrlToBlob(dataUrl), "avatar.jpg");
  return api.fileUrl(id);
}

async function loadLibraryFile(id: string, remoteFirst = false, remoteCache: RequestCache = "no-store") {
  if (remoteFirst) {
    // E-Books use Drive as the source of truth; a stale local cache must not mask a missing Drive file.
    const remote = await api.downloadFile(id, { cache: remoteCache }).catch(() => null);
    if (remote) void saveBrowserFile(id, remote).catch(() => undefined);
    return remote;
  }
  const local = await loadBrowserFile(id).catch(() => null);
  if (local) return local;
  const remote = await api.downloadFile(id, { cache: remoteCache }).catch(() => null);
  if (remote) void saveBrowserFile(id, remote).catch(() => undefined);
  return remote;
}

function openFileDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB tidak tersedia di browser ini."));
      return;
    }
    const request = window.indexedDB.open(FILE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(FILE_STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Database file tidak dapat dibuka."));
  });
}

async function compressLosslessly(blob: Blob) {
  if (!("CompressionStream" in window)) return { blob, compressed: false };
  const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
  return { blob: await new Response(stream).blob(), compressed: true };
}

async function saveBrowserFile(id: string, file: Blob, compress = false) {
  const prepared = compress ? await compressLosslessly(file) : { blob: file, compressed: false };
  const database = await openFileDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(FILE_STORE_NAME, "readwrite");
    transaction.objectStore(FILE_STORE_NAME).put({ id, blob: prepared.blob, compressed: prepared.compressed, originalType: file.type } satisfies BrowserFileRecord);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("File tidak dapat disimpan."));
  });
  database.close();
}

async function loadBrowserFile(id: string) {
  const database = await openFileDatabase();
  const record = await new Promise<BrowserFileRecord | undefined>((resolve, reject) => {
    const request = database.transaction(FILE_STORE_NAME, "readonly").objectStore(FILE_STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as BrowserFileRecord | undefined);
    request.onerror = () => reject(request.error ?? new Error("File tidak dapat dibaca."));
  });
  database.close();
  if (!record) return null;
  if (!record.compressed || !("DecompressionStream" in window)) return record.blob;
  const stream = record.blob.stream().pipeThrough(new DecompressionStream("gzip"));
  return new Blob([await new Response(stream).arrayBuffer()], { type: record.originalType });
}

async function deleteBrowserFile(id: string) {
  const database = await openFileDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(FILE_STORE_NAME, "readwrite");
    transaction.objectStore(FILE_STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("File tidak dapat dihapus."));
  });
  database.close();
}

const STATE_DB_NAME = "al-haytham-library-state";
const STATE_STORE_NAME = "kv";

function openStateDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB tidak tersedia di browser ini."));
      return;
    }
    const request = window.indexedDB.open(STATE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STATE_STORE_NAME)) {
        request.result.createObjectStore(STATE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Database state tidak dapat dibuka."));
  });
}

async function readStateValue(key: string) {
  const database = await openStateDatabase();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const request = database.transaction(STATE_STORE_NAME, "readonly").objectStore(STATE_STORE_NAME).get(key);
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function writeStateValue(key: string, value: string) {
  const database = await openStateDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STATE_STORE_NAME, "readwrite");
      transaction.objectStore(STATE_STORE_NAME).put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Nilai tidak dapat disimpan."));
    });
  } finally {
    database.close();
  }
}

async function readAppData(key: string) {
  // 1) IndexedDB dulu (sumber utama).
  try {
    const idbValue = await readStateValue(key);
    if (idbValue !== null) return idbValue;
  } catch {
    // Lanjut ke localStorage.
  }
  // 2) localStorage (legacy) + migrasi otomatis ke IndexedDB.
  try {
    const legacyValue = window.localStorage.getItem(key);
    if (legacyValue !== null) {
      try {
        await writeStateValue(key, legacyValue);
      } catch {
        // Migrasi gagal; nilai lama tetap dipakai sesi ini.
      }
    }
    return legacyValue;
  } catch {
    return null;
  }
}

async function writeAppData(key: string, value: string) {
  try {
    await writeStateValue(key, value);
  } catch {
    // Fallback ke localStorage bila IndexedDB gagal (mis. mode privat).
    window.localStorage.setItem(key, value);
  }
}

const APP_DATA_KEYS = [
  EBOOK_STORAGE_KEY,
  BOOK_STORAGE_KEY,
  MEMBERS_STORAGE_KEY,
  CLASSES_STORAGE_KEY,
  LOANS_STORAGE_KEY,
  CATEGORY_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  AVATAR_SHAPE_STORAGE_KEY,
  READING_PROGRESS_STORAGE_KEY,
];

async function cleanupLegacyStorage() {
  try {
    for (const key of APP_DATA_KEYS) {
      if (window.localStorage.getItem(key) === null) continue;
      const idbValue = await readStateValue(key);
      if (idbValue !== null) {
        // IndexedDB sudah menjadi sumber data → hapus salinan lama di localStorage.
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Pembersihan gagal; data lama dibiarkan sebagai cadangan.
  }
}

const PDFJS_WORKER_CACHE_ID = "pdfjs-worker-source";

async function loadPdfWorkerBlobUrl() {
  // 1) Gunakan salinan worker dari IndexedDB bila sudah pernah dimuat (offline penuh).
  try {
    const cached = await loadBrowserFile(PDFJS_WORKER_CACHE_ID);
    if (cached) return URL.createObjectURL(cached);
  } catch {
    // Lanjut ke jaringan.
  }
  // 2) Unduh sekali dari server (HTTP cache diutamakan), lalu simpan untuk pemakaian offline.
  const response = await fetch("/pdf.worker.min.mjs", { cache: "force-cache" });
  if (!response.ok) throw new Error("Worker pdf.js tidak dapat dimuat.");
  const blob = await response.blob();
  try {
    await saveBrowserFile(PDFJS_WORKER_CACHE_ID, blob, true);
  } catch {
    // Gagal menyimpan; blob tetap bisa dipakai pada sesi ini.
  }
  return URL.createObjectURL(blob);
}

let pdfjsModulePromise: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;

function getPdfjsModule() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs").then(async (module) => {
      module.GlobalWorkerOptions.workerSrc = await loadPdfWorkerBlobUrl();
      return module;
    });
  }
  return pdfjsModulePromise;
}

const pdfCoverCache = new Map<string, Promise<string | null>>();

function getPdfCover(fileId: string, blob: Blob) {
  let pending = pdfCoverCache.get(fileId);
  if (!pending) {
    pending = renderPdfPageToDataUrl(blob, 1, 340);
    pdfCoverCache.set(fileId, pending);
  }
  return pending;
}

async function renderPdfPageToDataUrl(blob: Blob, pageNumber: number, maxWidth: number) {
  try {
    const pdfjs = await getPdfjsModule();
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
    } catch (error) {
      task.destroy().catch(() => undefined);
      return null;
    }
  } catch {
    return null;
  }
}

const initialEbooks: EBook[] = [
  { title: "Laskar Pelangi", author: "Andrea Hirata", category: "Fiksi", code: "EB-00018", stock: 0, available: 0, color: "#dcefe6", initials: "LP", format: "PDF", size: "4,2 MB", access: "Baca online" },
  { title: "Bumi", author: "Tere Liye", category: "Fiksi", code: "EB-00024", stock: 0, available: 0, color: "#f5e9d9", initials: "BU", format: "EPUB", size: "2,8 MB", access: "Baca online" },
  { title: "Ensiklopedia Sains Digital", author: "Tim Edukasi", category: "Pendidikan", code: "EB-00031", stock: 0, available: 0, color: "#e8f0df", initials: "ES", format: "PDF", size: "8,6 MB", access: "Baca online" },
  { title: "Panduan Belajar Efektif", author: "Perpustakaan Al-Haytham", category: "Pendidikan", code: "EB-00042", stock: 0, available: 0, color: "#e8e8f8", initials: "PB", format: "PDF", size: "3,1 MB", access: "Baca online" },
];

const initialBooks: Book[] = [
  { title: "Laskar Pelangi", author: "Andrea Hirata", category: "Fiksi", code: "BK-00124", stock: 8, available: 5, color: "#e5f2ee", initials: "LP" },
  { title: "Bumi", author: "Tere Liye", category: "Fiksi", code: "BK-00118", stock: 6, available: 2, color: "#f5e9d9", initials: "BU" },
  { title: "Atomic Habits", author: "James Clear", category: "Pengembangan Diri", code: "BK-00203", stock: 5, available: 4, color: "#e8e8f8", initials: "AH" },
  { title: "Filosofi Teras", author: "Henry Manampiring", category: "Non-fiksi", code: "BK-00176", stock: 4, available: 0, color: "#f4e5e2", initials: "FT" },
  { title: "Laut Bercerita", author: "Leila S. Chudori", category: "Fiksi", code: "BK-00211", stock: 5, available: 3, color: "#dfeef3", initials: "LB" },
  { title: "Ensiklopedia Sains", author: "Tim Edukasi", category: "Pendidikan", code: "BK-00087", stock: 10, available: 8, color: "#e8f0df", initials: "ES" },
];

const initialCategories = ["Fiksi", "Pendidikan", "Pengembangan Diri", "Non-fiksi"];
const initialClasses = ["X IPS 1", "XI IPA 2", "XII IPA 1", "XI IPS 2"];
type MemberRole = "Admin" | "Guru" | "Siswa";
type Member = { name: string; code: string; className: string; joined: string; status: string; initials: string; color: string; role: MemberRole; username: string; password: string; avatarData?: string; avatarName?: string; email?: string; phone?: string; bio?: string; avatarShape?: string; themeMode?: string };

async function migrateLocalFilesToDrive(
  books: Book[],
  ebooks: EBook[],
  members: Member[],
  updateMembers: (members: Member[]) => void,
  onError?: (message: string) => void
) {
  let nextMembers = members;
  for (const item of books) {
    if (!item.coverId) continue;
    const local = await loadBrowserFile(item.coverId).catch(() => null);
    if (!local) continue;
    const file = new File([local], item.coverName ?? "cover", { type: local.type || "image/jpeg" });
    const optimized = await compressImageFile(file);
    await api.uploadFile(item.coverId, optimized, item.coverName ?? optimized.name);
  }
  for (const item of ebooks) {
    if (!item.fileId) continue;
    try {
      // Preserve an existing Drive copy; only migrate when the remote file is absent.
      if (await api.fileExists(item.fileId)) continue;
    } catch (error) {
      onError?.(`File E-Book “${item.title}” tidak dapat diperiksa di Google Drive: ${error instanceof Error ? error.message : "coba lagi"}.`);
      continue;
    }
    // Only attempt migration if there is a local file to upload.
    // If the file is missing from both Drive and local cache (e.g. uploaded
    // from another device), skip silently — the user can re-upload through Edit.
    const local = await loadBrowserFile(item.fileId).catch(() => null);
    if (!local) continue;
    try {
      await api.uploadFileResumable(item.fileId, local, item.fileName ?? "ebook");
    } catch (error) {
      onError?.(`File E-Book “${item.title}” gagal dipindahkan ke Google Drive: ${error instanceof Error ? error.message : "coba lagi"}.`);
    }
  }
  for (const member of members) {
    if (!member.avatarData?.startsWith("data:")) continue;
    const remoteMember = { ...member, avatarData: await moveAvatarToRemote(`member-avatar:${member.code}`, member.avatarData) };
    await api.updateMember(remoteMember);
    nextMembers = nextMembers.map((item) => item.code === member.code ? remoteMember : item);
    updateMembers(nextMembers);
  }
}

type LoanStatus = "Dipinjam" | "Terlambat" | "Dikembalikan";
type Loan = { id: string; member: string; memberCode: string; book: string; bookCode: string; borrowed: string; borrowedDate?: string; due: string; dueDate?: string; returnedDate?: string; status: LoanStatus; avatar: string; color: string; avatarData?: string };

type ReservationStatus = "Menunggu" | "Tersedia" | "Selesai" | "Dibatalkan";
type Reservation = { id: string; member: string; memberCode: string; book: string; bookCode: string; reservedAt: string; status: ReservationStatus; notifiedAt?: string; avatar: string; color: string; avatarData?: string };

const initialMembers: Member[] = [
  { name: "Rina Nuraini", code: "ADM-001", className: "Admin Perpustakaan", joined: "10 Jan 2024", status: "Aktif", initials: "RN", color: "#cfe4da", role: "Admin", username: "admin.alhaytham", password: "AlHaytham123!" },
  { name: "Ahmad Fauzi", code: "GR-2024-006", className: "Guru Bahasa Indonesia", joined: "15 Jan 2024", status: "Aktif", initials: "AF", color: "#dce9f5", role: "Guru", username: "ahmad.fauzi", password: "Guru2024!" },
  { name: "Nadia Putri", code: "AG-2024-001", className: "XI IPA 2", joined: "12 Jan 2024", status: "Aktif", initials: "NP", color: "#f5d9c8", role: "Siswa", username: "nadia.putri", password: "Nadia2024!" },
  { name: "Raka Pratama", code: "AG-2024-014", className: "X IPS 1", joined: "18 Jan 2024", status: "Aktif", initials: "RP", color: "#dce9f5", role: "Siswa", username: "raka.pratama", password: "Raka2024!" },
  { name: "Salsa Aulia", code: "AG-2023-087", className: "XII IPA 1", joined: "09 Agu 2023", status: "Aktif", initials: "SA", color: "#e6dff2", role: "Siswa", username: "salsa.aulia", password: "Salsa2024!" },
  { name: "Bima Aditya", code: "AG-2024-032", className: "XI IPS 2", joined: "02 Feb 2024", status: "Nonaktif", initials: "BA", color: "#e3eadc", role: "Siswa", username: "bima.aditya", password: "Bima2024!" },
];

function memberCodeForRole(role: MemberRole, membersList: Member[]) {
  const prefix = role === "Admin" ? "ADM" : role === "Guru" ? "GR" : "AG";
  const codes = membersList.filter((member) => member.role === role).map((member) => Number(member.code.match(/(\d+)$/)?.[1] ?? 0));
  const nextNumber = Math.max(0, ...codes) + 1;
  return role === "Admin" ? `${prefix}-${String(nextNumber).padStart(3, "0")}` : `${prefix}-${new Date().getFullYear()}-${String(nextNumber).padStart(3, "0")}`;
}

function createMemberUsername(name: string) {
  return name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
}

function formatMemberJoinDate() {
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date()).replace(/\./g, "");
}

async function getReadingProgress(ebookCode: string) {
  try {
    const raw = await readAppData(READING_PROGRESS_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    const page = map?.[ebookCode];
    return typeof page === "number" && Number.isFinite(page) && page > 0 ? page : null;
  } catch {
    return null;
  }
}

async function saveReadingProgress(ebookCode: string, page1Based: number) {
  try {
    const raw = await readAppData(READING_PROGRESS_STORAGE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    if (typeof map !== "object" || map === null || Array.isArray(map)) return;
    map[ebookCode] = page1Based;
    await writeAppData(READING_PROGRESS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Progres tidak tersimpan; tidak mengganggu pembaca.
  }
}

async function clearReadingProgress(ebookCode: string) {
  try {
    const raw = await readAppData(READING_PROGRESS_STORAGE_KEY);
    if (!raw) return;
    const map = JSON.parse(raw);
    if (typeof map !== "object" || map === null || Array.isArray(map)) return;
    delete map[ebookCode];
    await writeAppData(READING_PROGRESS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Abaikan bila pembersihan gagal.
  }
}

type StudentImportRow = { rowNumber: number; name: string; className: string; username: string; password: string };
type StudentImportSummary = { added: number; errors: string[] };

function normalizeSpreadsheetHeader(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[*!]/g, "").replace(/\s+/g, " ").trim();
}

async function parseStudentWorkbook(file: File) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("Workbook tidak memiliki sheet yang dapat dibaca.");
  const worksheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: "" }) as unknown[][];
  const headers = matrix[0] ?? [];
  const normalizedHeaders = headers.map(normalizeSpreadsheetHeader);
  const findColumn = (aliases: string[]) => normalizedHeaders.findIndex((header) => aliases.includes(header));
  const nameIndex = findColumn(["nama siswa", "nama lengkap", "nama"]);
  const classIndex = findColumn(["kelas", "kelas siswa"]);
  const usernameIndex = findColumn(["username"]);
  const passwordIndex = findColumn(["password"]);
  if (nameIndex < 0 || classIndex < 0) throw new Error("Kolom wajib “Nama Siswa” dan “Kelas” tidak ditemukan. Gunakan template yang disediakan.");

  const rows: StudentImportRow[] = [];
  matrix.slice(1).forEach((row, index) => {
    const readCell = (columnIndex: number) => columnIndex < 0 ? "" : String(row[columnIndex] ?? "").trim();
    const name = readCell(nameIndex);
    const className = readCell(classIndex);
    const username = readCell(usernameIndex);
    const password = readCell(passwordIndex);
    if (!name && !className && !username && !password) return;
    if (name.toUpperCase().startsWith("[CONTOH]")) return;
    rows.push({ rowNumber: index + 2, name, className, username, password });
  });
  if (rows.length === 0) throw new Error("Belum ada data siswa. Isi baris pada sheet “Data Siswa”, lalu import kembali.");
  return rows;
}

async function downloadStudentTemplate(classes: string[]) {
  const XLSX = await import("xlsx");
  const dataRows = [["Nama Siswa", "Kelas", "Username (opsional)", "Password (opsional)"], ["[CONTOH] Siti Aminah", classes[0] ?? "", "", ""], ...Array.from({ length: 18 }, () => ["", "", "", ""])];
  const dataSheet = XLSX.utils.aoa_to_sheet(dataRows);
  dataSheet["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 24 }, { wch: 24 }];
  dataSheet["!autofilter"] = { ref: "A1:D20" };
  const instructionSheet = XLSX.utils.aoa_to_sheet([
    ["PETUNJUK IMPORT SISWA"],
    ["1. Isi satu baris untuk satu siswa pada sheet Data Siswa."],
    ["2. Kolom Nama Siswa dan Kelas wajib diisi."],
    ["3. Kolom Kelas harus sama persis dengan daftar pada sheet Referensi Kelas atau menu Anggota > Siswa > Tambah Kelas."],
    ["4. Jangan mengubah atau menghapus judul kolom agar file dapat dibaca sistem."],
    ["5. Username dan Password boleh dikosongkan; sistem akan membuatnya otomatis."],
    ["6. Semua data yang diimport akan menjadi Siswa dengan status Aktif."],
    ["7. Baris [CONTOH] boleh dihapus atau akan dilewati otomatis saat import."],
  ]);
  instructionSheet["!cols"] = [{ wch: 115 }];
  const referenceSheet = XLSX.utils.aoa_to_sheet([["Kelas tersedia saat template dibuat"], ...classes.map((className) => [className])]);
  referenceSheet["!cols"] = [{ wch: 38 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, "Data Siswa");
  XLSX.utils.book_append_sheet(workbook, instructionSheet, "Petunjuk");
  XLSX.utils.book_append_sheet(workbook, referenceSheet, "Referensi Kelas");
  XLSX.writeFile(workbook, "template-import-siswa-al-haytham.xlsx");
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

function csvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function safeFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function downloadMemberAccount(member: Member) {
  const csv = ["Nama,Peran,Kode,Kelas/Jabatan,Username,Password,Status", [member.name, member.role, member.code, member.className, member.username, member.password, member.status].map(csvCell).join(",")].join("\n");
  downloadTextFile(`${safeFileName(member.name)}-akun.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
}

function downloadMemberCard(member: Member) {
  const avatarHtml = member.avatarData ? `<img src="${member.avatarData}" alt="Foto ${escapeHtml(member.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block" />` : escapeHtml(member.initials);
  const card = `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Kartu Anggota - ${escapeHtml(member.name)}</title><style>body{margin:0;padding:40px;background:#f4f7f5;font-family:Arial,sans-serif;color:#1c2925}.card{width:720px;max-width:100%;margin:auto;background:#fff;border:1px solid #dce8e2;border-radius:18px;overflow:hidden;box-shadow:0 16px 35px #25413518}.top{padding:28px 32px;background:#e8f3ee;color:#37735e;font-weight:700;font-size:20px}.body{display:flex;gap:24px;padding:30px 32px;align-items:center}.avatar{width:92px;height:92px;border-radius:50%;display:grid;place-items:center;overflow:hidden;background:${member.color};color:#38705d;font-size:27px;font-weight:700}.details{display:grid;gap:8px}.name{font-size:25px;font-weight:700}.role{color:#4f9078;font-weight:700}.meta{color:#71807a;font-size:14px}.code{margin-left:auto;padding:12px 16px;border:1px dashed #9fc5b4;border-radius:10px;color:#37735e;font-weight:700;text-align:center}.code small{display:block;color:#8a9b93;font-size:10px;margin-top:4px}@media print{body{padding:0;background:#fff}.card{box-shadow:none}}</style></head><body><main class="card"><div class="top">Al-Haytham Library · Kartu Anggota</div><div class="body"><div class="avatar">${avatarHtml}</div><div class="details"><div class="name">${escapeHtml(member.name)}</div><div class="role">${escapeHtml(member.role)}</div><div class="meta">${escapeHtml(member.className)}</div><div class="meta">Bergabung: ${escapeHtml(member.joined)}</div></div><div class="code">${escapeHtml(member.code)}<small>ID ANGGOTA</small></div></div></main></body></html>`;
  downloadTextFile(`${safeFileName(member.name)}-kartu-anggota.html`, card, "text/html;charset=utf-8");
}

const initialLoans: Loan[] = [
  { id: "loan-demo-1", member: "Nadia Putri", memberCode: "AG-2024-001", book: "Atomic Habits", bookCode: "BK-00203", borrowed: "18 Jun 2024", due: "25 Jun 2024", status: "Dipinjam", avatar: "NP", color: "#f5d9c8" },
  { id: "loan-demo-2", member: "Raka Pratama", memberCode: "AG-2024-014", book: "Laskar Pelangi", bookCode: "BK-00124", borrowed: "14 Jun 2024", due: "21 Jun 2024", status: "Terlambat", avatar: "RP", color: "#dce9f5" },
  { id: "loan-demo-3", member: "Salsa Aulia", memberCode: "AG-2023-087", book: "Laut Bercerita", bookCode: "BK-00211", borrowed: "19 Jun 2024", due: "26 Jun 2024", status: "Dipinjam", avatar: "SA", color: "#e6dff2" },
  { id: "loan-demo-4", member: "Dimas Saputra", memberCode: "LEGACY-DIMAS", book: "Filosofi Teras", bookCode: "BK-00176", borrowed: "04 Jun 2024", due: "11 Jun 2024", status: "Dikembalikan", avatar: "DS", color: "#dce9db" },
];

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

function formatLoanDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`)).replace(/\\./g, "");
}

function getLoanStatus(loan: Loan) {
  if (loan.status === "Dikembalikan") return loan.status;
  return loan.dueDate && loan.dueDate < dateInputValue() ? "Terlambat" : loan.status;
}

const navItems: { key: PageKey; label: string; icon: IconName }[] = [
  { key: "overview", label: "Ringkasan", icon: "grid" },
  { key: "ebooks", label: "Katalog E-Book", icon: "monitor" },
  { key: "books", label: "Katalog Buku", icon: "book" },
  { key: "members", label: "Anggota", icon: "users" },
  { key: "loans", label: "Peminjaman", icon: "repeat" },
  { key: "reservations", label: "Reservasi", icon: "clock" },
  { key: "reports", label: "Laporan", icon: "barChart" },
];

function Icon({ name, size = 19, strokeWidth = 1.8, style }: { name: IconName; size?: number; strokeWidth?: number; style?: React.CSSProperties }) {
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
  };

  return <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style}>{paths[name]}</svg>;
}

function StatusPill({ status }: { status: string }) {
  const style = status === "Terlambat" || status === "Nonaktif" ? "status-danger" : status === "Dikembalikan" ? "status-success" : "status-warning";
  return <span className={`status-pill ${style}`}><span className="status-dot" />{status}</span>;
}

type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
};

function ConfirmDialog({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await request.onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onClick={busy ? undefined : onClose}><div className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">KONFIRMASI</span><h2 id="confirm-title">{request.title}</h2></div><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Tutup"><Icon name="close" size={20} /></button></div><p className="confirm-message">{request.message}</p><div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose} disabled={busy}>Batal</button><button type="button" className={`button ${request.danger ? "button-danger" : "button-primary"}`} onClick={() => void confirm()} disabled={busy}>{busy ? "Memproses..." : request.confirmLabel ?? "Lanjutkan"}</button></div></div></div>;
}

function BookCover({ book, small = false }: { book: Pick<Book, "initials" | "color" | "title" | "coverId" | "coverName">; small?: boolean }) {
  const [coverUrl, setCoverUrl] = useState("");
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  useEffect(() => {
    if (!thumbnailFailed || !book.coverId) return;
    let active = true;
    let objectUrl = "";
    loadLibraryFile(book.coverId, false, "force-cache").then((blob) => {
      if (!active || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setCoverUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [book.coverId, thumbnailFailed]);

  const thumbnail = book.coverId ? api.coverThumbnailUrl(book.coverId, book.coverName ?? "cover") : "";
  return <div className={`book-cover ${small ? "book-cover-small" : ""}`} style={{ backgroundColor: book.color }}>
    {!thumbnailFailed && thumbnail ? <img src={thumbnail} alt={`Cover ${book.title}`} loading="lazy" decoding="async" onError={() => setThumbnailFailed(true)} /> : coverUrl ? <img src={coverUrl} alt={`Cover ${book.title}`} /> : <><span>{book.initials}</span><i>{book.title.split(" ")[0]}</i></>}
  </div>;
}

function ebookCoverCacheId(ebook: EBook) {
  return `ebook-cover:${ebook.fileId ?? ebook.code}:${ebook.size}:${ebook.fileName ?? ""}`;
}

function EbookCover({ ebook }: { ebook: EBook }) {
  const [coverUrl, setCoverUrl] = useState("");
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    if (thumbnailFailed && ebook.fileId && ebook.format === "PDF") {
      const cacheId = ebookCoverCacheId(ebook);
      loadBrowserFile(cacheId).then(async (cached) => {
        if (!active) return null;
        if (cached) {
          objectUrl = URL.createObjectURL(cached);
          return objectUrl;
        }
        const blob = await loadLibraryFile(ebook.fileId as string);
        if (!active || !blob) return null;
        const dataUrl = await getPdfCover(ebook.fileId as string, blob);
        if (dataUrl) {
          const thumbnail = await dataUrlToBlob(dataUrl).catch(() => null);
          if (thumbnail) await saveBrowserFile(cacheId, thumbnail).catch(() => undefined);
        }
        return dataUrl;
      }).then((dataUrl) => {
        if (active && dataUrl) setCoverUrl(dataUrl);
      }).catch(() => undefined);
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [ebook.fileId, ebook.format, ebook.size, ebook.fileName, thumbnailFailed]);

  const thumbnail = ebook.fileId && ebook.format === "PDF"
    ? api.coverThumbnailUrl(ebook.fileId, `${ebook.size}:${ebook.fileName ?? ""}`)
    : "";
  if (!thumbnailFailed && thumbnail) {
    return <div className="book-cover ebook-cover-image"><img src={thumbnail} alt={`Cover ${ebook.title}`} loading="lazy" decoding="async" onError={() => setThumbnailFailed(true)} /></div>;
  }
  return coverUrl ? <div className="book-cover ebook-cover-image"><img src={coverUrl} alt={`Cover ${ebook.title}`} /></div> : <BookCover book={ebook} />;
}

function useCountUp(target: number, duration = 700): number {
  const [display, setDisplay] = useState(0);
  const lastRef = useRef(0);
  const displayRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setDisplay(target);
      displayRef.current = target;
      lastRef.current = target;
      return;
    }
    const from = lastRef.current;
    const to = target;
    if (from === to) return;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(from + (to - from) * eased);
      displayRef.current = value;
      setDisplay(value);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        lastRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}

function CountUp({ value, duration = 700 }: { value: number; duration?: number }) {
  const display = useCountUp(value, duration);
  return <>{display}</>;
}

function StatCard({ icon, label, value, change, context, up, accent }: { icon: IconName; label: string; value: string; change: string; context: string; up?: boolean; accent: string }) {
  return <div className="stat-card">
    <div className="stat-card-top"><span className={`stat-icon ${accent}`}><Icon name={icon} size={19} /></span><button className="icon-button subtle" aria-label="Opsi"><Icon name="more" size={18} /></button></div>
    <div className="stat-label">{label}</div>
    <div className="stat-value"><CountUp value={Number(value)} /></div>
    <div className={`stat-change ${up ? "positive" : "negative"}`}><Icon name={up ? "arrowUp" : "arrowDown"} size={13} />{change}<span className="change-label">{context}</span></div>
  </div>;
}

function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Overview({ onNavigate, onQuickLoan, booksList, ebooksList, membersList, loansList, adminName }: { onNavigate: (page: PageKey) => void; onQuickLoan: () => void; booksList: Book[]; ebooksList: EBook[]; membersList: Member[]; loansList: Loan[]; adminName: string }) {
  const memberMap = new Map(membersList.map((m) => [m.code, m]));
  const activeMembers = membersList.filter((member) => member.status === "Aktif");
  const activeLoans = loansList.filter((loan) => getLoanStatus(loan) !== "Dikembalikan");
  const overdueLoans = loansList.filter((loan) => getLoanStatus(loan) === "Terlambat");
  const lowStockBooks = booksList.filter((book) => book.available <= 2);
  const totalCollections = booksList.length + ebooksList.length;
  const attentionCount = overdueLoans.length + lowStockBooks.length;
  const popularBooks = [...booksList].sort((first, second) => (second.stock - second.available) - (first.stock - first.available)).slice(0, 4);
  const loanStatusSummary = [
    { label: "Dipinjam", count: loansList.filter((loan) => getLoanStatus(loan) === "Dipinjam").length, color: "green" },
    { label: "Terlambat", count: overdueLoans.length, color: "orange" },
    { label: "Dikembalikan", count: loansList.filter((loan) => getLoanStatus(loan) === "Dikembalikan").length, color: "blue" },
  ];
  const maxLoanCount = Math.max(...loanStatusSummary.map((item) => item.count), 1);

  return <>
    <PageHeader title={`Selamat pagi, ${adminName.split(" ")[0]}`} description="Berikut ringkasan aktivitas perpustakaan hari ini." action={<button className="button button-primary" onClick={onQuickLoan}><Icon name="plus" size={17} /> Peminjaman baru</button>} />
    <div className="stat-grid">
      <StatCard icon="book" label="Total koleksi" value={String(totalCollections)} change={`${booksList.length} buku`} context={`${ebooksList.length} E-Book`} up accent="green" />
      <StatCard icon="users" label="Anggota aktif" value={String(activeMembers.length)} change={`${membersList.length} terdaftar`} context="data anggota" up accent="blue" />
      <StatCard icon="repeat" label="Sedang dipinjam" value={String(activeLoans.length)} change={`${overdueLoans.length} terlambat`} context="data transaksi" up={overdueLoans.length === 0} accent="orange" />
      <StatCard icon="alert" label="Perlu perhatian" value={String(attentionCount)} change={`${overdueLoans.length} terlambat`} context={`${lowStockBooks.length} stok menipis`} up={attentionCount === 0} accent="red" />
    </div>
    <div className="dashboard-grid">
      <section className="panel activity-panel">
        <div className="panel-heading"><div><h2>Ringkasan transaksi</h2><p>Distribusi berdasarkan data peminjaman saat ini</p></div><span className="select-button">Data saat ini</span></div>
        <div className="summary-bars">{loanStatusSummary.map((item) => <div className="summary-bar-item" key={item.label}><strong><CountUp value={item.count} duration={800} /></strong><div className={`summary-bar ${item.color}`} style={{ height: `${Math.max(12, (item.count / maxLoanCount) * 100)}%` }} /><span>{item.label}</span></div>)}</div>
      </section>
      <section className="panel attention-panel"><div className="panel-heading"><div><h2>Perlu perhatian</h2><p>Hal yang membutuhkan tindakan</p></div><button className="text-button" onClick={() => onNavigate("loans")}>Lihat semua</button></div><div className="attention-list"><button className="attention-item attention-item-button" onClick={() => onNavigate("loans")}><span className="attention-icon late"><Icon name="clock" size={17} /></span><div><strong>{overdueLoans.length} peminjaman terlambat</strong><span>{overdueLoans.length > 0 ? "Perlu segera ditindaklanjuti" : "Tidak ada peminjaman terlambat"}</span></div><Icon name="chevron" size={16} /></button><button className="attention-item attention-item-button" onClick={() => onNavigate("books")}><span className="attention-icon stock"><Icon name="book" size={17} /></span><div><strong>{lowStockBooks.length} buku stok menipis</strong><span>{lowStockBooks.length > 0 ? "Stok tersedia kurang dari 3" : "Semua stok buku aman"}</span></div><Icon name="chevron" size={16} /></button></div></section>
    </div>
    <div className="dashboard-grid lower-grid">
      <section className="panel table-panel"><div className="panel-heading"><div><h2>Peminjaman terbaru</h2><p>Transaksi yang baru saja tercatat</p></div><button className="text-button" onClick={() => onNavigate("loans")}>Lihat semua</button></div><div className="table-scroll"><table><thead><tr><th>Anggota</th><th>Buku</th><th>Tanggal pinjam</th><th>Status</th></tr></thead><tbody>{loansList.slice(0, 3).map((loan) => { const memberAvatar = memberMap.get(loan.memberCode)?.avatarData; return <tr key={loan.member}><td><div className="person"><span className="avatar" style={{ backgroundColor: loan.color }}>{memberAvatar ? <img src={memberAvatar} alt={`Foto ${loan.member}`} /> : loan.avatar}</span><span><b>{loan.member}</b><small>Anggota perpustakaan</small></span></div></td><td>{loan.book}</td><td>{loan.borrowed}</td><td><StatusPill status={loan.status} /></td></tr>; })}</tbody></table></div></section>
      <section className="panel popular-panel"><div className="panel-heading"><div><h2>Buku paling banyak dipinjam</h2><p>Berdasarkan stok yang sedang keluar</p></div><button className="icon-button subtle" aria-label="Opsi"><Icon name="more" size={18} /></button></div><div className="popular-list">{popularBooks.map((book, index) => <div className="popular-book" key={book.code}><span className="rank">0{index + 1}</span><BookCover book={book} small /><div className="popular-info"><b>{book.title}</b><span>{book.author}</span></div><strong>{book.stock - book.available}x</strong></div>)}</div></section>
    </div>
  </>;
}

const CATALOG_PAGE_SIZE = 9;

type CatalogPaginationProps = { page: number; totalItems: number; onChange: (page: number) => void };

function CatalogPagination({ page, totalItems, onChange }: CatalogPaginationProps) {
  const totalPages = Math.ceil(totalItems / CATALOG_PAGE_SIZE);
  if (totalPages <= 1) return null;
  const pageItems: Array<number | "left-ellipsis" | "right-ellipsis"> = totalPages <= 7
    ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : page <= 4
      ? [1, 2, 3, 4, 5, "right-ellipsis", totalPages]
      : page >= totalPages - 3
        ? [1, "left-ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
        : [1, "left-ellipsis", page - 1, page, page + 1, "right-ellipsis", totalPages];
  return <nav className="catalog-pagination" aria-label="Navigasi halaman katalog"><button type="button" className="catalog-page-arrow" disabled={page === 1} onClick={() => onChange(page - 1)}>‹ Sebelumnya</button><div className="catalog-page-numbers">{pageItems.map((item, index) => item === "left-ellipsis" || item === "right-ellipsis" ? <span className="catalog-page-ellipsis" key={`${item}-${index}`}>…</span> : <button type="button" className={`catalog-page-number ${item === page ? "active" : ""}`} aria-current={item === page ? "page" : undefined} aria-label={`Halaman ${item}`} key={item} onClick={() => onChange(item)}>{item}</button>)}</div><button type="button" className="catalog-page-arrow" disabled={page === totalPages} onClick={() => onChange(page + 1)}>Berikutnya ›</button></nav>;
}

function EBooksPage({ ebooks, categories, onAdd, isAdmin, onRead, onEdit, onDelete }: { ebooks: EBook[]; categories: string[]; onAdd: () => void; isAdmin: boolean; onRead: (ebook: EBook) => void; onEdit: (ebook: EBook) => void; onDelete: (ebook: EBook) => void }) {
  const [search, setSearch] = useState("");
  const [fileNotice, setFileNotice] = useState("");
  const [busyFile, setBusyFile] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [formatFilter, setFormatFilter] = useState("");
  const [menuOpenFor, setMenuOpenFor] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!menuOpenFor) return;
    const closeMenu = () => setMenuOpenFor("");
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [menuOpenFor]);
  const filtered = useMemo(() => ebooks.filter((ebook) => {
    const matchesSearch = `${ebook.title} ${ebook.author} ${ebook.category}`.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || ebook.category === categoryFilter;
    const matchesFormat = !formatFilter || ebook.format === formatFilter;
    return matchesSearch && matchesCategory && matchesFormat;
  }), [search, ebooks, categoryFilter, formatFilter]);
  const activeFilterCount = Number(Boolean(categoryFilter)) + Number(Boolean(formatFilter));
  const totalPages = Math.max(1, Math.ceil(filtered.length / CATALOG_PAGE_SIZE));
  const paginated = filtered.slice((currentPage - 1) * CATALOG_PAGE_SIZE, currentPage * CATALOG_PAGE_SIZE);
  useEffect(() => { setCurrentPage(1); }, [search, categoryFilter, formatFilter]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);
  const resetFilters = () => { setCategoryFilter(""); setFormatFilter(""); };

  const handleRead = (ebook: EBook) => {
    if (!ebook.fileId) {
      setFileNotice(`File untuk “${ebook.title}” belum tersedia. Silakan upload file E-Book terlebih dahulu.`);
      return;
    }
    onRead(ebook);
  };

  const handleDownload = async (ebook: EBook) => {
    if (!ebook.fileId) {
      setFileNotice(`File untuk “${ebook.title}” belum tersedia. Silakan upload file E-Book terlebih dahulu.`);
      return;
    }
    setBusyFile(ebook.fileId);
    setFileNotice("");
    try {
      const blob = await loadLibraryFile(ebook.fileId, true);
      if (!blob) throw new Error("File tidak ditemukan");
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = ebook.fileName ?? `${ebook.title}.${ebook.format.toLowerCase()}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
    } catch {
      setFileNotice(`File “${ebook.title}” tidak dapat diunduh. Silakan upload ulang bila diperlukan.`);
    } finally {
      setBusyFile("");
    }
  };

  return <><PageHeader title="Katalog E-Book" description="Temukan koleksi digital yang dapat dibaca kapan saja. File tersimpan aman di Google Drive." action={<button className="button button-primary" onClick={onAdd}><Icon name="plus" size={17} /> Tambah E-Book</button>} /><div className="toolbar"><label className="search-box"><Icon name="search" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari judul, penulis, atau kategori..." /></label><div className="filter-control"><button className={`button button-outline ${activeFilterCount > 0 ? "filter-active" : ""}`} aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}><Icon name="filter" size={16} /> Filter{activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}</button>{filterOpen && <div className="filter-panel" role="dialog" aria-label="Filter Katalog E-Book"><div className="filter-panel-header"><strong>Filter E-Book</strong><button type="button" className="text-button" onClick={resetFilters}>Reset</button></div><label className="filter-field">Kategori<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Semua kategori</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label className="filter-field">Format<select value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)}><option value="">Semua format</option><option value="PDF">PDF</option><option value="EPUB">EPUB</option><option value="MOBI">MOBI</option></select></label><button type="button" className="button button-primary filter-done" onClick={() => setFilterOpen(false)}>Terapkan</button></div>}</div><button className="button button-outline"><Icon name="download" size={16} /> Export</button></div>{fileNotice && <div className="form-error storage-warning"><Icon name="alert" size={16} />{fileNotice}</div>}<div className="book-grid">{paginated.map((ebook) => <article className="book-card ebook-card" key={ebook.code}><div className="book-card-cover"><EbookCover ebook={ebook} /><span className="stock-label">{ebook.format}</span></div><div className="book-card-body"><div className="book-category">{ebook.category}</div><h3>{ebook.title}</h3><p>{ebook.author}</p>{ebook.fileName && <span className="ebook-file" title={ebook.fileName}>📎 {ebook.fileName}</span>}<div className="book-meta"><span>{ebook.format} · {ebook.size}</span>{isAdmin && <div className="ebook-menu-wrap"><button className="icon-button subtle" aria-label={`Opsi ${ebook.title}`} aria-expanded={menuOpenFor === ebook.code} onClick={(event) => { event.stopPropagation(); setMenuOpenFor(menuOpenFor === ebook.code ? "" : ebook.code); }}><Icon name="more" size={17} /></button>{menuOpenFor === ebook.code && <div className="ebook-menu" role="menu"><button role="menuitem" onClick={() => { setMenuOpenFor(""); onEdit(ebook); }}><Icon name="edit" size={15} /> Edit</button><button role="menuitem" className="danger" onClick={() => { setMenuOpenFor(""); onDelete(ebook); }}><Icon name="trash" size={15} /> Hapus</button></div>}</div>}</div>{ebook.fileId && <div className="ebook-actions"><button className="button button-outline" onClick={() => handleRead(ebook)} disabled={busyFile === ebook.fileId}><Icon name="book" size={14} /> Baca</button><button className="button button-outline" onClick={() => handleDownload(ebook)} disabled={busyFile === ebook.fileId}><Icon name="download" size={14} /> Download</button></div>}</div></article>)}</div><CatalogPagination page={currentPage} totalItems={filtered.length} onChange={setCurrentPage} />{filtered.length === 0 && <div className="empty-state"><Icon name="search" size={30} /><h3>E-Book tidak ditemukan</h3><p>Coba gunakan kata kunci pencarian lain.</p></div>}</>;
}

async function resolveOutline(doc: pdfjsLib.PDFDocumentProxy, nodes: PdfOutlineNode[]): Promise<TocEntry[]> {
  const entries: TocEntry[] = [];
  for (const node of nodes) {
    let pageIndex: number | null = null;
    if (node.dest) {
      try {
        const resolved = typeof node.dest === "string" ? await doc.getDestination(node.dest) : node.dest;
        if (resolved && resolved.length > 0 && typeof resolved[0] === "object" && resolved[0] !== null && "num" in resolved[0]) {
          pageIndex = await doc.getPageIndex(resolved[0] as Parameters<typeof doc.getPageIndex>[0]);
        }
      } catch {
        pageIndex = null;
      }
    }
    entries.push({ title: node.title, pageIndex, children: node.items.length > 0 ? await resolveOutline(doc, node.items) : [] });
  }
  return entries;
}

function OutlineList({ entries, depth, onJump }: { entries: TocEntry[]; depth: number; onJump: (pageIndex: number) => void }) {
  return <>{entries.map((entry, index) => <div key={`${depth}-${index}`}>{entry.pageIndex !== null ? <button type="button" className="toc-item" style={{ paddingLeft: `${depth * 18 + 14}px` }} onClick={() => onJump(entry.pageIndex as number)}>{entry.title}<span className="toc-page">{entry.pageIndex + 1}</span></button> : <div className="toc-item toc-heading" style={{ paddingLeft: `${depth * 18 + 14}px` }}>{entry.title}</div>}{entry.children.length > 0 && <OutlineList entries={entry.children} depth={depth + 1} onJump={onJump} />}</div>)}</>;
}

// Deteksi halaman ilustrasi: (1) gambar raster yang menutupi sebagian besar halaman,
// atau (2) gambar vektor besar dengan hampir tanpa teks (mis. ilustrasi buku Dilan).
async function isIllustrationPage(doc: pdfjsLib.PDFDocumentProxy, pageNumber: number, pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs")): Promise<boolean> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const pageArea = viewport.width * viewport.height;
  const operatorList = await page.getOperatorList();
  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  let maxCoverage = 0;
  let textOps = 0;
  let inkMinX = Infinity;
  let inkMinY = Infinity;
  let inkMaxX = -Infinity;
  let inkMaxY = -Infinity;
  const fns = operatorList.fnArray;
  const argsArray = operatorList.argsArray;
  const addPoint = (x: number, y: number) => {
    const px = ctm[0] * x + ctm[2] * y + ctm[4];
    const py = ctm[1] * x + ctm[3] * y + ctm[5];
    if (px < inkMinX) inkMinX = px;
    if (py < inkMinY) inkMinY = py;
    if (px > inkMaxX) inkMaxX = px;
    if (py > inkMaxY) inkMaxY = py;
  };
  // Format data path pdf.js (DrawOPS): 0=moveTo, 1=lineTo, 2=curveTo, 3=quadraticCurveTo, 4=closePath.
  const parsePathData = (data: number[]) => {
    let j = 0;
    while (j < data.length) {
      const code = data[j++];
      if (code === 0 || code === 1) {
        addPoint(data[j], data[j + 1]);
        j += 2;
      } else if (code === 2) {
        addPoint(data[j], data[j + 1]);
        addPoint(data[j + 2], data[j + 3]);
        addPoint(data[j + 4], data[j + 5]);
        j += 6;
      } else if (code === 3) {
        addPoint(data[j], data[j + 1]);
        addPoint(data[j + 2], data[j + 3]);
        j += 4;
      } else if (code === 4) {
        // closePath
      } else {
        break;
      }
    }
  };
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i];
    const args = argsArray[i];
    if (fn === pdfjs.OPS.save) {
      stack.push(ctm.slice());
    } else if (fn === pdfjs.OPS.restore) {
      ctm = stack.pop() ?? ctm;
    } else if (fn === pdfjs.OPS.transform) {
      const [a, b, c, d, e, f] = args as number[];
      const [A, B, C, D, E, F] = ctm;
      ctm = [A * a + C * b, B * a + D * b, A * c + C * d, B * c + D * d, A * e + C * f + E, B * e + D * f + F];
    } else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintImageMaskXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
      let width: number;
      let height: number;
      if (fn === pdfjs.OPS.paintInlineImageXObject) {
        const image = args[0] as { width: number; height: number };
        width = image.width;
        height = image.height;
      } else {
        width = args[1] as number;
        height = args[2] as number;
      }
      const paintedWidth = Math.abs(ctm[0] * width + ctm[2] * height);
      const paintedHeight = Math.abs(ctm[1] * width + ctm[3] * height);
      const x = ctm[4];
      const y = ctm[5];
      const intersectWidth = Math.max(0, Math.min(x + paintedWidth, viewport.width) - Math.max(0, x));
      const intersectHeight = Math.max(0, Math.min(y + paintedHeight, viewport.height) - Math.max(0, y));
      maxCoverage = Math.max(maxCoverage, (intersectWidth * intersectHeight) / pageArea);
      addPoint(x, y);
      addPoint(x + paintedWidth, y + paintedHeight);
    } else if (fn === pdfjs.OPS.showText) {
      textOps++;
    } else if (fn === pdfjs.OPS.moveTo) {
      addPoint(args[0] as number, args[1] as number);
    } else if (fn === pdfjs.OPS.lineTo) {
      addPoint(args[0] as number, args[1] as number);
    } else if (fn === pdfjs.OPS.curveTo) {
      addPoint(args[0] as number, args[1] as number);
      addPoint(args[2] as number, args[3] as number);
      addPoint(args[4] as number, args[5] as number);
    } else if (fn === pdfjs.OPS.curveTo2) {
      addPoint(args[2] as number, args[3] as number);
      addPoint(args[4] as number, args[5] as number);
    } else if (fn === pdfjs.OPS.curveTo3) {
      addPoint(args[0] as number, args[1] as number);
      addPoint(args[2] as number, args[3] as number);
    } else if (fn === pdfjs.OPS.rectangle) {
      addPoint(args[0] as number, args[1] as number);
      addPoint((args[0] as number) + (args[2] as number), (args[1] as number) + (args[3] as number));
    } else if (fn === pdfjs.OPS.constructPath) {
      const paintOp = args[0] as number;
      if (paintOp === pdfjs.OPS.fill || paintOp === pdfjs.OPS.eoFill || paintOp === pdfjs.OPS.stroke || paintOp === pdfjs.OPS.fillStroke || paintOp === pdfjs.OPS.eoFillStroke) {
        const pathData = args[1] as ArrayLike<ArrayLike<number>>;
        if (pathData && pathData.length > 0 && pathData[0]) {
          parsePathData(Array.from(pathData[0]));
        }
      }
    }
  }
  // 1) Gambar raster penuh halaman.
  if (maxCoverage >= 0.65) return true;
  // 2) Ilustrasi vektor: hampir tanpa teks dan tinta menutupi sebagian besar halaman.
  if (inkMaxX >= inkMinX && inkMaxY >= inkMinY) {
    const inkArea = (inkMaxX - inkMinX) * (inkMaxY - inkMinY);
    if (textOps <= 3 && inkArea >= 0.35 * pageArea) return true;
  }
  return false;
}

export type ReadingMode = "flipbook" | "scroll";

/** Field minimum yang dipakai pembaca — sengaja lepas dari tipe EBook agar portal anggota bisa memakainya. */
export type ReadableEBook = { title: string; author: string; format: string; code: string; fileId?: string };

type JumpRequest = { page: number; nonce: number };

const READING_MODE_STORAGE_KEY = "al-haytham-library:reading-mode:v1";

/**
 * Mode baca terakhir di perangkat ini. `null` berarti belum pernah memilih
 * (per pemilik perangkat baru), sehingga klik "Baca" masih menampilkan pemilih mode.
 */
export function getSavedReadingMode(): ReadingMode | null {
  try {
    const raw = window.localStorage.getItem(READING_MODE_STORAGE_KEY);
    return raw === "flipbook" || raw === "scroll" ? raw : null;
  } catch {
    return null;
  }
}

export function rememberReadingMode(mode: ReadingMode) {
  try {
    window.localStorage.setItem(READING_MODE_STORAGE_KEY, mode);
  } catch {
    // Penyimpanan diblokir (mis. mode privat): pilihan hanya berlaku selama sesi ini.
  }
}

/** Pilihan mode yang muncul ketika pengguna menekan tombol "Baca". */
export function ReadingModeDialog({ ebook, onPick, onClose }: { ebook: ReadableEBook; onPick: (mode: ReadingMode) => void; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal reading-mode-modal" role="dialog" aria-modal="true" aria-labelledby="reading-mode-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">MODE MEMBACA</span><h2 id="reading-mode-title">{ebook.title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Tutup"><Icon name="close" size={20} /></button></div><p className="reading-mode-hint">Pilihan Anda akan diingat di perangkat ini, jadi berikutnya klik Baca langsung membuka mode itu. Mode tetap bisa diganti kapan saja lewat toolbar pembaca.</p><div className="reading-mode-options"><button type="button" className="reading-mode-card" onClick={() => onPick("flipbook")}><span className="reading-mode-art art-flipbook" aria-hidden="true"><i /><i /></span><strong>Flipbook</strong><span className="reading-mode-desc">Dua halaman berdampingan dengan animasi membalik, seperti buku fisik.</span></button><button type="button" className="reading-mode-card" onClick={() => onPick("scroll")}><span className="reading-mode-art art-scroll" aria-hidden="true"><i /><i /><i /></span><strong>Scroll</strong><span className="reading-mode-desc">Halaman bertumpuk ke bawah — ringan dan selalu terasa seperti membaca PDF.</span></button></div></div></div>;
}

export function EbookReader({ ebook, mode, onModeChange, onClose }: { ebook: ReadableEBook; mode: ReadingMode; onModeChange: (mode: ReadingMode) => void; onClose: () => void }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [scrollPage, setScrollPage] = useState(0);
  const [jump, setJump] = useState<JumpRequest | null>(null);
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [angle, setAngle] = useState(0);
  const [turning, setTurning] = useState(false);
  const [flipDir, setFlipDir] = useState<1 | -1>(1);
  const [zoom, setZoom] = useState(1);
  const [tocOpen, setTocOpen] = useState(false);
  const [outline, setOutline] = useState<TocEntry[] | null>(null);
  const [outlineReady, setOutlineReady] = useState(false);
  const [resumeNotice, setResumeNotice] = useState("");
  const [imagePages, setImagePages] = useState<ReadonlySet<number> | null>(null);
  const leftRef = useRef<HTMLCanvasElement | null>(null);
  const rightRef = useRef<HTMLCanvasElement | null>(null);
  const singleRef = useRef<HTMLCanvasElement | null>(null);
  const flipFrontRef = useRef<HTMLCanvasElement | null>(null);
  const flipBackRef = useRef<HTMLCanvasElement | null>(null);
  const leafRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<HTMLDivElement | null>(null);
  const loadingTaskRef = useRef<ReturnType<typeof pdfjsLib.getDocument> | null>(null);
  const pdfjsRef = useRef<typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null>(null);
  const renderTokenRef = useRef(0);
  const flipTimeoutRef = useRef(0);
  const totalSpreads = Math.max(1, Math.ceil(totalPages / 2));
  const leftPage = spreadIndex * 2 + 1;
  const rightPage = spreadIndex * 2 + 2;
  const singlePage = imagePages !== null ? (imagePages.has(leftPage) ? leftPage : rightPage <= totalPages && imagePages.has(rightPage) ? rightPage : null) : null;

  const renderPageTo = useCallback(async (pageNumber: number, canvas: HTMLCanvasElement | null, scaleFactor: number, token: number, fullWidth = false) => {
    if (!doc || !canvas) return;
    const page = await doc.getPage(pageNumber);
    if (token !== renderTokenRef.current) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const area = bookRef.current;
    const areaWidth = area ? area.clientWidth : 1080;
    const areaHeight = area ? area.clientHeight : 590;
    const padding = 36;
    const fitWidth = fullWidth ? areaWidth - padding : (areaWidth - padding) / 2 - 12;
    const fit = Math.min(fitWidth / baseViewport.width, (areaHeight - padding) / baseViewport.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale: fit * scaleFactor * dpr });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
    await page.render({ canvas, viewport }).promise;
  }, [doc]);

  const clearCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (context) {
      canvas.width = 1;
      canvas.height = 1;
      context.clearRect(0, 0, 1, 1);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!ebook.fileId) throw new Error("File E-Book belum tersedia.");
        const blob = await loadLibraryFile(ebook.fileId, true);
        if (!blob) throw new Error("File E-Book tidak ditemukan.");
        const data = new Uint8Array(await blob.arrayBuffer());
        const pdfjs = await getPdfjsModule();
        pdfjsRef.current = pdfjs;
        const task = pdfjs.getDocument({ data, cMapUrl: "/cmaps/", cMapPacked: true, standardFontDataUrl: "/standard_fonts/", wasmUrl: "/wasm/" });
        loadingTaskRef.current = task;
        const loaded = await task.promise;
        if (cancelled) return;
        const storedPage = await getReadingProgress(ebook.code);
        const initialSpread = storedPage === null ? 0 : Math.min(Math.max(Math.floor((storedPage - 1) / 2), 0), Math.max(0, Math.ceil(loaded.numPages / 2) - 1));
        setDoc(loaded);
        setTotalPages(loaded.numPages);
        setSpreadIndex(initialSpread);
        if (storedPage !== null && storedPage > 1) setResumeNotice(`Dilanjutkan dari halaman ${storedPage}`);
        setStatus("ready");
        try {
          const rawOutline = await loaded.getOutline();
          if (cancelled) return;
          setOutline(rawOutline && rawOutline.length > 0 ? await resolveOutline(loaded, rawOutline as PdfOutlineNode[]) : null);
        } catch {
          if (!cancelled) setOutline(null);
        } finally {
          if (!cancelled) setOutlineReady(true);
        }
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "File E-Book tidak dapat dibaca.");
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [ebook.fileId]);

  useEffect(() => () => { if (loadingTaskRef.current) loadingTaskRef.current.destroy(); window.clearTimeout(flipTimeoutRef.current); }, []);

  useEffect(() => {
    if (status !== "ready" || mode !== "flipbook" || !doc || imagePages !== null) return;
    const pdfjs = pdfjsRef.current;
    if (!pdfjs) return;
    let cancelled = false;
    (async () => {
      const result = new Set<number>();
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
        if (cancelled) return;
        try {
          if (await isIllustrationPage(doc, pageNumber, pdfjs)) result.add(pageNumber);
        } catch {
          // Halaman gagal diperiksa diabaikan (tetap tampil sebagai spread).
        }
        if (!cancelled && (pageNumber % 8 === 0 || pageNumber === doc.numPages)) setImagePages(new Set(result));
        if (pageNumber % 4 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
    })();
    return () => { cancelled = true; };
  }, [status, mode, doc, imagePages]);

  useEffect(() => {
    if (status !== "ready" || mode !== "flipbook" || !doc) return;
    const token = ++renderTokenRef.current;
    if (singlePage !== null) {
      clearCanvas(leftRef.current);
      clearCanvas(rightRef.current);
      renderPageTo(singlePage, singleRef.current, zoom, token, true).catch(() => undefined);
    } else {
      clearCanvas(singleRef.current);
      renderPageTo(leftPage, leftRef.current, zoom, token).catch(() => undefined);
      if (rightPage <= totalPages) {
        renderPageTo(rightPage, rightRef.current, zoom, token).catch(() => undefined);
      } else {
        clearCanvas(rightRef.current);
      }
    }
  }, [doc, spreadIndex, status, zoom, totalPages, renderPageTo, leftPage, rightPage, clearCanvas, singlePage]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    if (status !== "ready") return;
    saveReadingProgress(ebook.code, singlePage ?? leftPage);
  }, [leftPage, singlePage, status, ebook.code]);

  // Mode scroll: progres ikut halaman teratas yang sedang terlihat.
  useEffect(() => {
    if (status !== "ready" || mode !== "scroll" || scrollPage < 1) return;
    saveReadingProgress(ebook.code, scrollPage);
  }, [scrollPage, mode, status, ebook.code]);

  // Balik ke flipbook: samakan spread dengan posisi terakhir di mode scroll
  // supaya pembaca tidak melompat kembali ke halaman yang lebih awal.
  useEffect(() => {
    if (mode !== "flipbook" || scrollPage < 1 || totalPages === 0) return;
    const targetSpread = Math.min(Math.floor((scrollPage - 1) / 2), Math.max(0, Math.ceil(totalPages / 2) - 1));
    setSpreadIndex((current) => (current === targetSpread ? current : targetSpread));
  }, [mode, scrollPage, totalPages]);

  useEffect(() => {
    if (!resumeNotice) return;
    const timer = window.setTimeout(() => setResumeNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [resumeNotice]);

  const goTo = useCallback((delta: 1 | -1) => {
    if (turning || status !== "ready" || !doc) return;
    const nextSpread = spreadIndex + delta;
    if (nextSpread < 0 || nextSpread >= totalSpreads) return;
    const token = ++renderTokenRef.current;
    const nextLeftPage = delta === 1 ? rightPage + 1 : leftPage - 2;
    const nextRightPage = delta === 1 ? rightPage + 2 : leftPage - 1;
    const nextSingle = imagePages !== null ? (imagePages.has(nextLeftPage) ? nextLeftPage : nextRightPage >= 1 && nextRightPage <= totalPages && imagePages.has(nextRightPage) ? nextRightPage : null) : null;
    const backPage = nextSingle !== null ? nextSingle : delta === 1 ? rightPage + 1 : leftPage - 1;
    if (delta === 1) {
      // Maju: halaman kanan (atau halaman gambar tunggal) menyapu ke kiri.
      renderPageTo(singlePage !== null ? singlePage : rightPage, flipFrontRef.current, zoom, token).catch(() => undefined);
      if (backPage >= 1 && backPage <= totalPages) renderPageTo(backPage, flipBackRef.current, zoom, token).catch(() => undefined);
      else clearCanvas(flipBackRef.current);
      if (nextSingle === null && rightPage + 2 <= totalPages) renderPageTo(rightPage + 2, rightRef.current, zoom, token).catch(() => undefined);
      else clearCanvas(rightRef.current);
    } else {
      // Mundur: halaman kiri (atau halaman gambar tunggal) menyapu ke kanan.
      renderPageTo(singlePage !== null ? singlePage : leftPage, flipFrontRef.current, zoom, token).catch(() => undefined);
      if (backPage >= 1 && backPage <= totalPages) renderPageTo(backPage, flipBackRef.current, zoom, token).catch(() => undefined);
      else clearCanvas(flipBackRef.current);
      if (nextSingle === null && leftPage - 2 >= 1) renderPageTo(leftPage - 2, leftRef.current, zoom, token).catch(() => undefined);
      else clearCanvas(leftRef.current);
    }
    setFlipDir(delta);
    setTurning(true);
    setAngle(0);
    requestAnimationFrame(() => requestAnimationFrame(() => setAngle(delta === 1 ? -180 : 180)));
    flipTimeoutRef.current = window.setTimeout(async () => {
      const leafElement = leafRef.current;
      leafElement?.classList.add("no-transition");
      setAngle(0);
      void leafElement?.offsetHeight;
      leafElement?.classList.remove("no-transition");
      // Pre-render halaman depan spread baru sebelum commit agar tidak ada flash halaman lama.
      const commitRender = nextSingle !== null
        ? renderPageTo(nextSingle, singleRef.current, zoom, token, true).catch(() => undefined)
        : (delta === 1
          ? renderPageTo(rightPage + 1, leftRef.current, zoom, token).catch(() => undefined)
          : renderPageTo(leftPage - 1, rightRef.current, zoom, token).catch(() => undefined));
      await Promise.race([commitRender, new Promise<void>((resolve) => window.setTimeout(resolve, 800))]);
      setSpreadIndex(nextSpread);
      setTurning(false);
    }, 680);
  }, [turning, status, doc, spreadIndex, totalSpreads, totalPages, zoom, renderPageTo, clearCanvas, leftPage, rightPage, singlePage, imagePages]);

  const jumpToPage = useCallback((targetIndex: number) => {
    if (turning || status !== "ready" || !doc) return;
    const targetPage = Math.min(Math.max(targetIndex + 1, 1), Math.max(totalPages, 1));
    if (mode === "scroll") {
      // Mode scroll: beri tahu ScrollStage agar ia yang menggeser ke halaman tujuan.
      setJump({ page: targetPage, nonce: Date.now() });
    } else {
      const targetSpread = Math.floor(targetIndex / 2);
      if (targetSpread === spreadIndex) {
        setTocOpen(false);
        return;
      }
      setSpreadIndex(targetSpread);
    }
    setTocOpen(false);
  }, [turning, status, doc, spreadIndex, mode, totalPages]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (tocOpen) {
          setTocOpen(false);
          return;
        }
        onClose();
      } else if (mode === "flipbook" && (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ")) {
        // Mode scroll memakai scroll native container, jadi hanya flipbook yang menangkap panah.
        event.preventDefault();
        goTo(1);
      } else if (mode === "flipbook" && (event.key === "ArrowLeft" || event.key === "PageUp")) {
        event.preventDefault();
        goTo(-1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goTo, onClose, tocOpen, mode]);

  const spreadLabel = singlePage !== null ? `Halaman ${singlePage} / ${totalPages}` : rightPage <= totalPages ? `Halaman ${leftPage}–${rightPage} / ${totalPages}` : `Halaman ${leftPage} / ${totalPages}`;
  const pageLabel = mode === "scroll" ? `Halaman ${scrollPage > 0 ? scrollPage : singlePage ?? leftPage} / ${totalPages}` : spreadLabel;

  return <div className="flipbook-overlay" role="dialog" aria-modal="true" aria-label={`Baca ${ebook.title}`}>
    <div className="flipbook-toolbar">
      <button type="button" className="icon-button" onClick={onClose} aria-label="Tutup pembaca"><Icon name="close" size={20} /></button>
      <div className="flipbook-title"><strong>{ebook.title}</strong><span>{ebook.author} · {ebook.format} · {mode === "scroll" ? "Scroll" : "Flipbook"}</span></div>
      <div className="flipbook-mode" role="group" aria-label="Mode membaca"><button type="button" className={mode === "flipbook" ? "active" : ""} aria-pressed={mode === "flipbook"} onClick={() => onModeChange("flipbook")}>Flipbook</button><button type="button" className={mode === "scroll" ? "active" : ""} aria-pressed={mode === "scroll"} onClick={() => onModeChange("scroll")}>Scroll</button></div>
      <div className="flipbook-tools">{outlineReady && outline && outline.length > 0 && <button type="button" className={`icon-button toc-button ${tocOpen ? "active" : ""}`} onClick={() => setTocOpen(!tocOpen)} aria-label="Daftar isi" aria-expanded={tocOpen}><Icon name="menu" size={18} /></button>}<span className="flipbook-page-info">{pageLabel}</span><span className="flipbook-zoom"><button type="button" className="zoom-button" onClick={() => setZoom((value) => Math.max(0.6, Number((value * 0.85).toFixed(2))))} aria-label="Perkecil">−</button><span>{Math.round(zoom * 100)}%</span><button type="button" className="zoom-button" onClick={() => setZoom((value) => Math.min(2.5, Number((value * 1.15).toFixed(2))))} aria-label="Perbesar">+</button></span></div>
    </div>
    {status === "loading" && <div className="flipbook-stage"><div className="flipbook-message"><span className="flipbook-spinner" /><strong>Membuka {ebook.title}…</strong><span>Menyiapkan halaman PDF</span></div></div>}
    {status === "error" && <div className="flipbook-stage"><div className="flipbook-message error"><Icon name="alert" size={28} /><strong>Gagal membuka file</strong><span>{errorMessage}</span><button type="button" className="button button-primary" onClick={onClose}>Tutup</button></div></div>}
    {status === "ready" && doc && <>{resumeNotice && <div className="flipbook-resume-notice" role="status">{resumeNotice}</div>}{mode === "scroll" ? <ScrollStage doc={doc} totalPages={totalPages} zoom={zoom} startPage={singlePage ?? leftPage} jump={jump} onPageChange={setScrollPage} /> : <><div className="flipbook-stage"><div className="flipbook-book" ref={bookRef}><div className="flipbook-spread">{singlePage !== null ? <div className="flipbook-single"><canvas ref={singleRef} /></div> : <><div className="flipbook-sheet left"><canvas ref={leftRef} /></div><div className="flipbook-sheet right"><canvas ref={rightRef} /></div></>}<div className={`flipbook-leaf ${flipDir === 1 ? "next" : "prev"} ${turning ? "" : "hidden"}`} ref={leafRef} style={{ transform: `rotateY(${angle}deg)` }}><div className="flipbook-face front"><canvas ref={flipFrontRef} /></div><div className="flipbook-face back"><canvas ref={flipBackRef} /></div></div></div></div><div className="flipbook-footer"><button type="button" className="button button-outline" onClick={() => goTo(-1)} disabled={turning || spreadIndex === 0}><Icon name="arrowUp" size={15} style={{ transform: "rotate(-90deg)" }} /> Sebelumnya</button><span className="flipbook-hint">Gunakan panah ← → atau spasi untuk membalik halaman</span><button type="button" className="button button-outline" onClick={() => goTo(1)} disabled={turning || spreadIndex >= totalSpreads - 1}>Berikutnya <Icon name="arrowUp" size={15} style={{ transform: "rotate(90deg)" }} /></button></div></div></>}{tocOpen && <div className="flipbook-toc-backdrop" onClick={() => setTocOpen(false)} />}{tocOpen && <aside className="flipbook-toc" role="complementary" aria-label="Daftar isi"><div className="flipbook-toc-header"><strong>Daftar isi</strong><button type="button" className="icon-button" onClick={() => setTocOpen(false)} aria-label="Tutup daftar isi"><Icon name="close" size={17} /></button></div><div className="flipbook-toc-body">{outline && outline.length > 0 ? <OutlineList entries={outline} depth={0} onJump={jumpToPage} /> : <div className="flipbook-toc-empty">Dokumen ini tidak memiliki daftar isi.</div>}</div></aside>}</>}
  </div>;
}

type ScrollStageProps = { doc: pdfjsLib.PDFDocumentProxy; totalPages: number; zoom: number; startPage: number; jump: JumpRequest | null; onPageChange: (page: number) => void };

/**
 * Mode scroll: seluruh halaman ditumpuk ke bawah, persis seperti membaca PDF.
 * Hanya halaman di sekitar viewport yang dirender (IntersectionObserver), lalu
 * dilepas kembali begitu jauh — memori tetap stabil untuk dokumen ratusan halaman.
 */
function ScrollStage({ doc, totalPages, zoom, startPage, jump, onPageChange }: ScrollStageProps) {
  const startRef = useRef(startPage);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef(new Map<number, HTMLDivElement>());
  const canvasRefs = useRef(new Map<number, HTMLCanvasElement>());
  const wantedRef = useRef(new Set<number>());
  const renderingRef = useRef(new Set<number>());
  const taskRefs = useRef(new Map<number, { cancel: () => void }>());
  const zoomRef = useRef(zoom);
  const widthRef = useRef(0);
  const currentPageRef = useRef(startPage);
  const frameRef = useRef(0);
  const positionedRef = useRef(false);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(1.414);
  const pages = useMemo(() => Array.from({ length: totalPages }, (_, index) => index + 1), [totalPages]);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Lebar area baca (content box, tanpa padding) jadi acuan ukuran halaman.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next <= 0) return;
      widthRef.current = next;
      setWidth((previous) => (Math.abs(previous - next) > 1 ? next : previous));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Rasio halaman pertama dipakai sebagai placeholder supaya tinggi dokumen tidak melompat.
  useEffect(() => {
    let cancelled = false;
    doc.getPage(1).then((page) => {
      const viewport = page.getViewport({ scale: 1 });
      if (!cancelled && viewport.width > 0) setRatio(viewport.width / viewport.height);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [doc]);

  const releasePage = useCallback((pageNumber: number) => {
    const task = taskRefs.current.get(pageNumber);
    if (task) {
      try { task.cancel(); } catch { /* sudah selesai */ }
    }
    const canvas = canvasRefs.current.get(pageNumber);
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
      canvas.style.width = "";
      canvas.style.height = "";
    }
  }, []);

  const renderPage = useCallback(async (pageNumber: number) => {
    const canvas = canvasRefs.current.get(pageNumber);
    const available = widthRef.current;
    if (!canvas || available <= 0 || renderingRef.current.has(pageNumber)) return;
    renderingRef.current.add(pageNumber);
    try {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const scale = ((available * zoomRef.current) / base.width) * dpr;
      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
      const task = page.render({ canvas, viewport });
      taskRefs.current.set(pageNumber, task);
      await task.promise;
    } catch {
      // Render dibatalkan karena halaman sudah keluar dari jangkauan.
    } finally {
      renderingRef.current.delete(pageNumber);
      taskRefs.current.delete(pageNumber);
    }
  }, [doc]);

  // Render halaman di sekitar viewport, lepas yang sudah jauh agar hemat memori.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const pageNumber = Number((entry.target as HTMLElement).dataset.page);
        if (!pageNumber) continue;
        if (entry.isIntersecting) {
          wantedRef.current.add(pageNumber);
          void renderPage(pageNumber);
        } else if (wantedRef.current.delete(pageNumber)) {
          releasePage(pageNumber);
        }
      }
    }, { root, rootMargin: "110% 0px", threshold: 0 });
    nodeRefs.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [doc, totalPages, renderPage, releasePage]);

  // Render ulang halaman yang sedang diinginkan setelah lebar atau zoom berubah.
  useEffect(() => {
    if (!width) return;
    const pending = Array.from(wantedRef.current).sort((a, b) => a - b);
    pending.forEach((pageNumber, index) => {
      window.setTimeout(() => {
        // Bisa saja halaman sudah keluar viewport sebelum giliran ini — jangan dirender ulang.
        if (!wantedRef.current.has(pageNumber)) return;
        void renderPage(pageNumber);
      }, index * 20);
    });
  }, [width, zoom, renderPage]);

  // Posisi awal: langsung menuju halaman terakhir dibaca.
  useEffect(() => {
    if (!width || positionedRef.current) return;
    const root = containerRef.current;
    const node = nodeRefs.current.get(startRef.current);
    if (!root || !node) return;
    positionedRef.current = true;
    root.scrollTop = Math.max(0, node.offsetTop - 16);
    currentPageRef.current = startRef.current;
    onPageChange(startRef.current);
  }, [width, onPageChange]);

  // Lompat dari daftar isi.
  useEffect(() => {
    if (!jump) return;
    const root = containerRef.current;
    const node = nodeRefs.current.get(jump.page);
    if (!root || !node) return;
    root.scrollTo({ top: Math.max(0, node.offsetTop - 16), behavior: "smooth" });
    currentPageRef.current = jump.page;
    onPageChange(jump.page);
  }, [jump, onPageChange]);

  const trackCurrentPage = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const marker = root.scrollTop + Math.min(root.clientHeight * 0.4, 260);
    let current = 1;
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      const node = nodeRefs.current.get(pageNumber);
      if (!node) continue;
      if (node.offsetTop <= marker) current = pageNumber;
      else break;
    }
    if (current !== currentPageRef.current) {
      currentPageRef.current = current;
      onPageChange(current);
    }
  }, [totalPages, onPageChange]);

  const handleScroll = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      trackCurrentPage();
    });
  }, [trackCurrentPage]);

  useEffect(() => {
    // Fokus ke container supaya panah atas/bawah dan PageUp/PageDown menggulir halaman.
    containerRef.current?.focus({ preventScroll: true });
    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      taskRefs.current.forEach((task) => { try { task.cancel(); } catch { /* abaikan */ } });
      taskRefs.current.clear();
    };
  }, []);

  const pageWidth = width > 0 ? Math.max(1, Math.round(width * zoom)) : 0;
  const pageHeight = pageWidth > 0 ? Math.round(pageWidth / ratio) : 0;

  return <div className="scroll-reader" ref={containerRef} tabIndex={0} onScroll={handleScroll} aria-label="Halaman dokumen">
    <div className="scroll-pages">
      {pages.map((pageNumber) => <div key={pageNumber} className="scroll-page" data-page={pageNumber} ref={(node) => { if (node) nodeRefs.current.set(pageNumber, node); else nodeRefs.current.delete(pageNumber); }} style={pageWidth > 0 ? { width: pageWidth, height: pageHeight } : undefined}>
        <canvas ref={(node) => { if (node) canvasRefs.current.set(pageNumber, node); else canvasRefs.current.delete(pageNumber); }} />
        <span className="scroll-page-number">{pageNumber}</span>
      </div>)}
    </div>
  </div>;
}

function EditEbookModal({ ebook, categories, onClose, onSave }: { ebook: EBook; categories: string[]; onClose: () => void; onSave: (ebook: EBook, file?: File, onProgress?: (percent: number) => void) => Promise<void> }) {
  const [title, setTitle] = useState(ebook.title);
  const [author, setAuthor] = useState(ebook.author);
  const [category, setCategory] = useState(ebook.category);
  const [format, setFormat] = useState(ebook.format);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(-1);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setError("");
    setUploadProgress(-1);
    if (!selectedFile) {
      setFile(null);
      return;
    }
    const extension = selectedFile.name.split(".").pop()?.toUpperCase() ?? "";
    if (!SUPPORTED_EBOOK_FORMATS.includes(extension as typeof SUPPORTED_EBOOK_FORMATS[number])) {
      setFile(null);
      event.target.value = "";
      setError("Format file harus PDF, EPUB, atau MOBI.");
      return;
    }
    setFile(selectedFile);
    setFormat(extension);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !author.trim() || !category.trim()) {
      setError("Lengkapi judul, penulis, dan kategori terlebih dahulu.");
      return;
    }
    setSaving(true);
    setError("");
    setUploadProgress(file ? 0 : -1);
    try {
      await onSave({ ...ebook, title: title.trim(), author: author.trim(), category: category.trim(), format, size: file ? formatFileSize(file.size) : ebook.size, fileName: file ? file.name : ebook.fileName }, file ?? undefined, (percent) => setUploadProgress(percent));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Perubahan tidak dapat disimpan. Silakan coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="ebook-edit-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">EDIT KOLEKSI DIGITAL</span><h2 id="ebook-edit-title">Edit E-Book</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Tutup"><Icon name="close" size={20} /></button></div><form onSubmit={submit}><div className="form-grid ebook-form"><label className="form-span">Judul E-Book<input value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} placeholder="Contoh: Si Kancil dan Buaya" /></label><label>Penulis<input value={author} onChange={(event) => { setAuthor(event.target.value); setError(""); }} placeholder="Contoh: Tim Penerbit" /></label><label>Kategori<select value={category} onChange={(event) => { setCategory(event.target.value); setError(""); }}><option value="">Pilih kategori</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Format<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="PDF">PDF</option><option value="EPUB">EPUB</option><option value="MOBI">MOBI</option></select></label><label className="form-span file-upload-label">Ganti file (opsional)<input className="file-input" type="file" accept=".pdf,.epub,.mobi,application/pdf,application/epub+zip,application/x-mobipocket-ebook" onChange={handleFileChange} /><span className="file-upload-box"><Icon name="download" size={17} /><span>{file ? file.name : ebook.fileName ?? "Pilih file baru untuk mengganti file saat ini"}<small>{file ? `${formatFileSize(file.size)} · akan menggantikan file lama` : `File saat ini: ${ebook.size}`}</small></span></span></label></div>{uploadProgress >= 0 && uploadProgress < 100 && <div className="upload-progress"><div className="upload-progress-bar"><div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} /></div><span className="upload-progress-text">{uploadProgress}% — mengunggah ke Google Drive</span></div>}{uploadProgress === 100 && <div className="form-success upload-done"><Icon name="check" size={16} /> File selesai diunggah ke Google Drive ✓</div>}{error && <div className="form-error"><Icon name="alert" size={16} />{error}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Batal</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Menyimpan..." : "Simpan perubahan"}</button></div></form></div></div>;
}

function AddEbookModal({ nextCode, categories, onClose, onAdd }: { nextCode: string; categories: string[]; onClose: () => void; onAdd: (ebook: EBook, file: File, onProgress?: (percent: number) => void) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [category, setCategory] = useState("");
  const [format, setFormat] = useState("PDF");
  const [file, setFile] = useState<File | null>(null);
  const [size, setSize] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(-1);
  const ebookColors = ["#dcefe6", "#f5e9d9", "#e8f0df", "#e8e8f8", "#f4e5e2", "#dfeef3"];

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] ?? null;
    setError("");
    setUploadProgress(-1);
    if (!selectedFile) {
      setFile(null);
      setSize("");
      return;
    }
    const extension = selectedFile.name.split(".").pop()?.toUpperCase() ?? "";
    if (!SUPPORTED_EBOOK_FORMATS.includes(extension as typeof SUPPORTED_EBOOK_FORMATS[number])) {
      setFile(null);
      setSize("");
      event.target.value = "";
      setError("Format file harus PDF, EPUB, atau MOBI.");
      return;
    }
    setFile(selectedFile);
    setFormat(extension);
    setSize(formatFileSize(selectedFile.size));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !author.trim() || !category.trim()) {
      setError("Lengkapi judul, penulis, dan kategori terlebih dahulu.");
      return;
    }
    if (!file) {
      setError("Pilih file E-Book terlebih dahulu.");
      return;
    }
    setSaving(true);
    setError("");
    setUploadProgress(0);
    try {
      await onAdd({ title: title.trim(), author: author.trim(), category: category.trim(), code: nextCode, stock: 0, available: 0, color: ebookColors[title.trim().length % ebookColors.length], initials: getInitials(title), format, size: formatFileSize(file.size), access: "Baca online", fileName: file.name, fileId: `ebook:${nextCode}` }, file, (percent) => setUploadProgress(percent));
    } catch (error) {
      setError(error instanceof Error ? error.message : "File tidak dapat disimpan ke Google Drive. Silakan coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="ebook-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">KOLEKSI DIGITAL BARU</span><h2 id="ebook-title">Tambah E-Book</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Tutup"><Icon name="close" size={20} /></button></div><form onSubmit={submit}><div className="form-grid ebook-form"><label className="form-span">Judul E-Book<input value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} placeholder="Contoh: Si Kancil dan Buaya" /></label><label>Penulis<input value={author} onChange={(event) => { setAuthor(event.target.value); setError(""); }} placeholder="Contoh: Tim Penerbit" /></label><label>Kategori<select value={category} onChange={(event) => { setCategory(event.target.value); setError(""); }}><option value="">Pilih kategori</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Format<select value={format} onChange={(event) => setFormat(event.target.value)}><option value="PDF">PDF</option><option value="EPUB">EPUB</option><option value="MOBI">MOBI</option></select></label><label className="form-span file-upload-label">File E-Book<input className="file-input" type="file" accept=".pdf,.epub,.mobi,application/pdf,application/epub+zip,application/x-mobipocket-ebook" onChange={handleFileChange} /><span className="file-upload-box"><Icon name="download" size={17} /><span>{file ? file.name : "Pilih file PDF, EPUB, atau MOBI"}<small>{file ? `${size} · tersimpan di Google Drive` : "Ukuran besar didukung · tersimpan di Google Drive"}</small></span></span></label></div>{uploadProgress >= 0 && uploadProgress < 100 && <div className="upload-progress"><div className="upload-progress-bar"><div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} /></div><span className="upload-progress-text">{uploadProgress}% — mengunggah ke Google Drive</span></div>}{uploadProgress === 100 && <div className="form-success upload-done"><Icon name="check" size={16} /> File selesai diunggah ke Google Drive ✓</div>}{error && <div className="form-error"><Icon name="alert" size={16} />{error}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Batal</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Menyimpan..." : "Tambah E-Book"}</button></div></form></div></div>;
}

function AddBookModal({ nextCode, categories, onClose, onAdd }: { nextCode: string; categories: string[]; onClose: () => void; onAdd: (book: Book, cover?: File) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [category, setCategory] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const colors = ["#e5f2ee", "#f5e9d9", "#e8e8f8", "#f4e5e2", "#dfeef3", "#e8f0df"];

  const handleCoverChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedCover = event.target.files?.[0] ?? null;
    setError("");
    if (selectedCover && !selectedCover.type.startsWith("image/")) {
      event.target.value = "";
      setCover(null);
      setError("Cover harus berupa file gambar seperti JPG, PNG, atau WEBP.");
      return;
    }
    setCover(selectedCover);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !author.trim() || !category.trim()) {
      setError("Lengkapi judul, penulis, dan kategori terlebih dahulu.");
      return;
    }
    setSaving(true);
    try {
      await onAdd({ title: title.trim(), author: author.trim(), category: category.trim(), code: nextCode, stock: 1, available: 1, color: colors[title.trim().length % colors.length], initials: getInitials(title), coverId: cover ? `book-cover:${nextCode}` : undefined, coverName: cover?.name }, cover ?? undefined);
    } catch (error) {
      setError(error instanceof Error && error.message ? error.message : "Cover atau data buku tidak dapat disimpan. Silakan coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="book-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">KOLEKSI BUKU BARU</span><h2 id="book-title">Tambah buku</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Tutup"><Icon name="close" size={20} /></button></div><form onSubmit={submit}><div className="form-grid"><label className="form-span">Judul buku<input value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} placeholder="Contoh: Negeri 5 Menara" /></label><label>Penulis<input value={author} onChange={(event) => { setAuthor(event.target.value); setError(""); }} placeholder="Contoh: Ahmad Fuadi" /></label><label>Kategori<select value={category} onChange={(event) => { setCategory(event.target.value); setError(""); }}><option value="">Pilih kategori</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="form-span file-upload-label">Upload cover buku<input className="file-input" type="file" accept="image/*" onChange={handleCoverChange} /><span className="file-upload-box"><Icon name="download" size={17} /><span>{cover ? cover.name : "Pilih gambar cover buku"}<small>{cover ? `${formatFileSize(cover.size)} · cover akan tampil di katalog` : "JPG, PNG, atau WEBP · tanpa mengurangi kualitas"}</small></span></span></label></div>{error && <div className="form-error"><Icon name="alert" size={16} />{error}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Batal</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Menyimpan..." : "Tambah buku"}</button></div></form></div></div>;
}

function EditBookModal({ book, categories, onClose, onSave }: { book: Book; categories: string[]; onClose: () => void; onSave: (book: Book, cover?: File) => Promise<void> }) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [category, setCategory] = useState(book.category);
  const [cover, setCover] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCoverChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedCover = event.target.files?.[0] ?? null;
    setError("");
    if (selectedCover && !selectedCover.type.startsWith("image/")) {
      event.target.value = "";
      setCover(null);
      setError("Cover harus berupa file gambar seperti JPG, PNG, atau WEBP.");
      return;
    }
    setCover(selectedCover);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !author.trim() || !category.trim()) {
      setError("Lengkapi judul, penulis, dan kategori terlebih dahulu.");
      return;
    }
    setSaving(true);
    try {
      await onSave({ ...book, title: title.trim(), author: author.trim(), category: category.trim(), coverName: cover ? cover.name : book.coverName }, cover ?? undefined);
    } catch (error) {
      setError(error instanceof Error && error.message ? error.message : "Perubahan tidak dapat disimpan. Silakan coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="book-edit-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">EDIT KOLEKSI BUKU</span><h2 id="book-edit-title">Edit buku</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Tutup"><Icon name="close" size={20} /></button></div><form onSubmit={submit}><div className="form-grid"><label className="form-span">Judul buku<input value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} placeholder="Contoh: Negeri 5 Menara" /></label><label>Penulis<input value={author} onChange={(event) => { setAuthor(event.target.value); setError(""); }} placeholder="Contoh: Ahmad Fuadi" /></label><label>Kategori<select value={category} onChange={(event) => { setCategory(event.target.value); setError(""); }}><option value="">Pilih kategori</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="form-span file-upload-label">Ganti cover (opsional)<input className="file-input" type="file" accept="image/*" onChange={handleCoverChange} /><span className="file-upload-box"><Icon name="download" size={17} /><span>{cover ? cover.name : book.coverName ?? "Pilih gambar untuk mengganti cover"}<small>{cover ? `${formatFileSize(cover.size)} · akan menggantikan cover lama` : book.coverName ? `Cover saat ini: ${book.coverName}` : "Belum ada cover"}</small></span></span></label></div>{error && <div className="form-error"><Icon name="alert" size={16} />{error}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Batal</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? "Menyimpan..." : "Simpan perubahan"}</button></div></form></div></div>;
}

function ReservationsPage({ reservationsList, booksList, membersList, onCancel, onFulfill }: { reservationsList: Reservation[]; booksList: Book[]; membersList: Member[]; onCancel: (reservation: Reservation) => void; onFulfill: (reservation: Reservation) => void }) {
  const memberMap = new Map(membersList.map((m) => [m.code, m]));
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | ReservationStatus>("");
  const [menuOpenFor, setMenuOpenFor] = useState("");

  useEffect(() => {
    if (!menuOpenFor) return;
    const closeMenu = () => setMenuOpenFor("");
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [menuOpenFor]);

  const filtered = useMemo(() => reservationsList.filter((reservation) => {
    const matchesSearch = `${reservation.member} ${reservation.book}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || reservation.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [search, reservationsList, statusFilter]);

  const waitingCount = reservationsList.filter((r) => r.status === "Menunggu").length;
  const readyCount = reservationsList.filter((r) => r.status === "Tersedia").length;

  return <>
    <PageHeader title="Reservasi buku" description="Kelola antrian siswa yang mengantri buku yang sedang habis dipinjam." />
    <div className="stat-grid">
      <StatCard icon="clock" label="Menunggu" value={String(waitingCount)} change="dalam antrian" context="reservasi aktif" up accent="orange" />
      <StatCard icon="check" label="Tersedia diambil" value={String(readyCount)} change="siap diambil" context="reservasi" up accent="green" />
    </div>
    <div className="toolbar">
      <label className="search-box"><Icon name="search" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama anggota atau judul buku..." /></label>
      <div className="filter-control">
        <select className="button button-outline" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | ReservationStatus)}>
          <option value="">Semua status</option>
          <option value="Menunggu">Menunggu</option>
          <option value="Tersedia">Tersedia</option>
          <option value="Selesai">Selesai</option>
        </select>
      </div>
    </div>
    {filtered.length > 0 ? (
      <div className="table-scroll"><table><thead><tr><th>Anggota</th><th>Buku</th><th>Tanggal reservasi</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{filtered.map((reservation) => (
        <tr key={reservation.id}>
          <td><div className="person"><span className="avatar" style={{ backgroundColor: reservation.color }}>{memberMap.get(reservation.memberCode)?.avatarData ? <img src={memberMap.get(reservation.memberCode)!.avatarData!} alt={`Foto ${reservation.member}`} /> : reservation.avatar}</span><span><b>{reservation.member}</b><small>{membersList.find((m) => m.code === reservation.memberCode)?.className ?? ""}</small></span></div></td>
          <td><div><b>{reservation.book}</b><small>{reservation.bookCode}</small></div></td>
          <td>{reservation.reservedAt}</td>
          <td><StatusPill status={reservation.status === "Menunggu" ? "Dipinjam" : reservation.status === "Tersedia" ? "Dikembalikan" : "Dikembalikan"} /><span style={{ marginLeft: 6, fontSize: 11, color: reservation.status === "Tersedia" ? "var(--green)" : reservation.status === "Menunggu" ? "var(--orange)" : "#9aa8a1" }}>{reservation.status}</span></td>
          <td>
            <div style={{ display: "flex", gap: 6 }}>
              {reservation.status === "Menunggu" && <button className="button button-outline" style={{ fontSize: 11, padding: "4px 10px", minHeight: 28 }} onClick={() => onCancel(reservation)}><Icon name="close" size={13} /> Batal</button>}
              {reservation.status === "Tersedia" && <button className="button button-primary" style={{ fontSize: 11, padding: "4px 10px", minHeight: 28 }} onClick={() => onFulfill(reservation)}><Icon name="check" size={13} /> Selesai</button>}
              {reservation.status === "Tersedia" && <button className="button button-outline" style={{ fontSize: 11, padding: "4px 10px", minHeight: 28 }} onClick={() => onCancel(reservation)}><Icon name="close" size={13} /> Batal</button>}
            </div>
          </td>
        </tr>
      ))}</tbody></table></div>
    ) : (
      <div className="empty-state"><Icon name="clock" size={30} /><h3>Belum ada reservasi</h3><p>Siswa dapat mengantri buku dari halaman katalog buku.</p></div>
    )}
  </>;
}

function BooksPage({ booksList, categories, onAdd, isAdmin, onEdit, onDelete, onReserve, reservationsList }: { booksList: Book[]; categories: string[]; onAdd: () => void; isAdmin: boolean; onEdit: (book: Book) => void; onDelete: (book: Book) => void; onReserve?: (bookCode: string) => boolean; reservationsList?: Reservation[] }) {
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("");
  const [menuOpenFor, setMenuOpenFor] = useState("");
  const [reserveMessage, setReserveMessage] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    if (!menuOpenFor) return;
    const closeMenu = () => setMenuOpenFor("");
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [menuOpenFor]);
  const filtered = useMemo(() => booksList.filter((book) => {
    const matchesSearch = `${book.title} ${book.author} ${book.category}`.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || book.category === categoryFilter;
    const matchesAvailability = !availabilityFilter || (availabilityFilter === "available" ? book.available > 0 : book.available === 0);
    return matchesSearch && matchesCategory && matchesAvailability;
  }), [search, booksList, categoryFilter, availabilityFilter]);
  const activeFilterCount = Number(Boolean(categoryFilter)) + Number(Boolean(availabilityFilter));
  const totalPages = Math.max(1, Math.ceil(filtered.length / CATALOG_PAGE_SIZE));
  const paginated = filtered.slice((currentPage - 1) * CATALOG_PAGE_SIZE, currentPage * CATALOG_PAGE_SIZE);
  useEffect(() => { setCurrentPage(1); }, [search, categoryFilter, availabilityFilter]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);
  const resetFilters = () => { setCategoryFilter(""); setAvailabilityFilter(""); };
  return <><PageHeader title="Katalog buku" description="Kelola koleksi buku dan tampilkan cover aslinya." action={<button className="button button-primary" onClick={onAdd}><Icon name="plus" size={17} /> Tambah buku</button>} /><div className="toolbar"><label className="search-box"><Icon name="search" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari judul, penulis, atau kategori..." /></label><div className="filter-control"><button className={`button button-outline ${activeFilterCount > 0 ? "filter-active" : ""}`} aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}><Icon name="filter" size={16} /> Filter{activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}</button>{filterOpen && <div className="filter-panel" role="dialog" aria-label="Filter Katalog Buku"><div className="filter-panel-header"><strong>Filter Buku</strong><button type="button" className="text-button" onClick={resetFilters}>Reset</button></div><label className="filter-field">Kategori<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Semua kategori</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label className="filter-field">Ketersediaan<select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)}><option value="">Semua status</option><option value="available">Tersedia</option><option value="out">Habis dipinjam</option></select></label><button type="button" className="button button-primary filter-done" onClick={() => setFilterOpen(false)}>Terapkan</button></div>}</div><button className="button button-outline"><Icon name="download" size={16} /> Export</button></div>{reserveMessage && <div className="form-error" style={{ marginBottom: 16 }}><Icon name="check" size={16} /> {reserveMessage}</div>}<div className="book-grid">{paginated.map((book) => { const hasReservation = reservationsList?.some((r) => r.bookCode === book.code && r.status === "Menunggu"); return <article className="book-card" key={book.code}><div className="book-card-cover"><BookCover book={book} /><span key={book.available} className={book.available === 0 ? "stock-label out" : "stock-label"}>{book.available === 0 ? "Habis dipinjam" : `${book.available} tersedia`}</span></div><div className="book-card-body"><div className="book-category">{book.category}</div><h3>{book.title}</h3><p>{book.author}</p>{book.coverName && <span className="ebook-file" title={book.coverName}>🖼️ {book.coverName}</span>}<div className="book-meta"><span>{book.code}</span>{isAdmin && <div className="ebook-menu-wrap"><button className="icon-button subtle" aria-label={`Opsi ${book.title}`} aria-expanded={menuOpenFor === book.code} onClick={(event) => { event.stopPropagation(); setMenuOpenFor(menuOpenFor === book.code ? "" : book.code); }}><Icon name="more" size={17} /></button>{menuOpenFor === book.code && <div className="ebook-menu" role="menu"><button role="menuitem" onClick={() => { setMenuOpenFor(""); onEdit(book); }}><Icon name="edit" size={15} /> Edit</button><button role="menuitem" className="danger" onClick={() => { setMenuOpenFor(""); onDelete(book); }}><Icon name="trash" size={15} /> Hapus</button></div>}</div>}</div>{book.available === 0 && onReserve && <div style={{ marginTop: 10 }}>{hasReservation ? <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 600 }}><Icon name="check" size={13} /> Sudah dalam antrian</span> : <button className="button button-outline" style={{ fontSize: 11, padding: "4px 10px", minHeight: 28, width: "100%" }} onClick={() => { const success = onReserve(book.code); setReserveMessage(success ? `Berhasil mengantri "${book.title}". Anda akan diberitahu saat buku tersedia.` : "Anda sudah mengantri buku ini."); setTimeout(() => setReserveMessage(""), 3000); }}><Icon name="clock" size={13} /> Reservasi buku</button>}</div>}</div></article>; })}</div><CatalogPagination page={currentPage} totalItems={filtered.length} onChange={setCurrentPage} />{filtered.length === 0 && <div className="empty-state"><Icon name="search" size={30} /><h3>Buku tidak ditemukan</h3><p>Coba gunakan kata kunci pencarian lain.</p></div>}</>;
}

function AvatarCropModal({ imageUrl, preview, onCancel, onConfirm }: { imageUrl: string; preview?: { name: string; role: string; detail: string; code?: string; color: string }; onCancel: () => void; onConfirm: (dataUrl: string) => void }) {
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

  return <div className="modal-backdrop crop-backdrop" role="presentation" onClick={onCancel}><div className="modal crop-modal" role="dialog" aria-modal="true" aria-labelledby="crop-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">ATUR FOTO</span><h2 id="crop-title">Potong foto</h2></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Tutup"><Icon name="close" size={20} /></button></div><div className="crop-layout"><div className="crop-left"><div className="crop-stage" ref={containerRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}><img ref={imgRef} src={source} alt="Pratinjau foto untuk dipotong" draggable={false} onLoad={handleLoad} style={displayStyle} /></div><div className="crop-zoom"><span>Perbesar</span><input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} /><span>{Math.round(zoom * 100)}%</span><button type="button" className="crop-rotate" onClick={rotateClockwise} disabled={!ready} aria-label="Putar foto 90 derajat" title="Putar 90°"><Icon name="rotate" size={15} /> Putar</button></div></div>{preview && <div className="crop-right"><span className="crop-preview-label">Pratinjau kartu anggota</span><div className="crop-card"><div className="crop-card-top">Al-Haytham Library · Kartu Anggota</div><div className="crop-card-body"><span className="crop-card-avatar" style={{ backgroundColor: preview.color }}>{previewUrl ? <img src={previewUrl} alt="Pratinjau foto hasil potong" /> : getInitials(preview.name)}</span><div className="crop-card-details"><b>{preview.name || "Nama anggota"}</b><span>{preview.role}</span><small>{preview.detail}</small></div>{preview.code && <div className="crop-card-code">{preview.code}<small>ID ANGGOTA</small></div>}</div></div></div>}</div><p className="crop-hint">Geser foto untuk mengatur posisi, gunakan penggeser untuk memperbesar. Hasil potong langsung terlihat di kartu anggota.</p><div className="modal-actions"><button type="button" className="button button-outline" onClick={onCancel}>Batal</button><button type="button" className="button button-primary" onClick={apply}>Terapkan</button></div></div></div>;
}

function AddMemberModal({ nextCodes, existingMembers, classes, onClose, onAdd }: { nextCodes: Record<MemberRole, string>; existingMembers: Member[]; classes: string[]; onClose: () => void; onAdd: (member: Member) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<MemberRole>("Siswa");
  const [className, setClassName] = useState(classes[0] ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [avatarData, setAvatarData] = useState<string | undefined>(undefined);
  const [avatarName, setAvatarName] = useState<string | undefined>(undefined);
  const [avatarError, setAvatarError] = useState("");
  const [avatarReading, setAvatarReading] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const colors = ["#cfe4da", "#dce9f5", "#f5d9c8", "#e6dff2", "#e3eadc", "#dfeef3"];
  const selectRole = (nextRole: MemberRole) => { setRole(nextRole); setClassName(nextRole === "Siswa" ? classes[0] ?? "" : ""); setError(""); };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setAvatarError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("Foto anggota harus berupa file gambar.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError("Ukuran foto maksimal 2 MB.");
      return;
    }
    const reader = new FileReader();
    setAvatarReading(true);
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
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

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedClassName = className.trim();
    if (!trimmedName || !trimmedClassName) {
      setError("Lengkapi nama dan kelas atau jabatan terlebih dahulu.");
      return;
    }
    const nextUsername = (username.trim() || createMemberUsername(trimmedName)).toLowerCase();
    if (!nextUsername) {
      setError("Username akun tidak dapat dibuat dari nama tersebut.");
      return;
    }
    if (existingMembers.some((member) => member.username.toLowerCase() === nextUsername)) {
      setError("Username sudah digunakan. Masukkan username lain.");
      return;
    }
    setSaving(true);
    const nextPassword = password.trim() || `AlHaytham${new Date().getFullYear()}!`;
    onAdd({ name: trimmedName, code: nextCodes[role], className: trimmedClassName, joined: formatMemberJoinDate(), status: "Aktif", initials: getInitials(trimmedName), color: colors[existingMembers.length % colors.length], role, username: nextUsername, password: nextPassword, avatarData, avatarName });
    setSaving(false);
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="member-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">AKUN ANGGOTA BARU</span><h2 id="member-title">Tambah anggota</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Tutup"><Icon name="close" size={20} /></button></div><form onSubmit={submit}><div className="form-grid"><div className="form-span member-avatar-row"><span className="avatar member-avatar-preview" style={{ backgroundColor: colors[existingMembers.length % colors.length] }}>{avatarData ? <img src={avatarData} alt="Pratinjau foto anggota" /> : getInitials(name) || "?"}</span><span className="member-avatar-controls"><b>Foto anggota <small>(opsional)</small></b><span className="avatar-actions"><label className="avatar-upload-label"><input className="file-input" type="file" accept="image/*" onChange={handleAvatarChange} /><span className="text-button avatar-upload-button"><Icon name="upload" size={13} />{avatarReading ? "Memproses..." : avatarData ? "Ganti foto" : "Upload foto"}</span></label>{avatarData && <button type="button" className="text-button avatar-remove-button" onClick={() => { setAvatarData(undefined); setAvatarName(undefined); setAvatarError(""); }}>Hapus foto</button>}</span></span></div><label className="form-span">Nama lengkap<input autoFocus value={name} onChange={(event) => { setName(event.target.value); setError(""); }} placeholder="Contoh: Dimas Saputra" /></label><label>Peran<select value={role} onChange={(event) => selectRole(event.target.value as MemberRole)}><option value="Siswa">Siswa</option><option value="Guru">Guru</option><option value="Admin">Admin</option></select></label><label>Kode anggota<input value={nextCodes[role]} readOnly /></label><label className="form-span">{role === "Siswa" ? "Kelas" : "Jabatan"}{role === "Siswa" ? <select value={className} onChange={(event) => { setClassName(event.target.value); setError(""); }}><option value="">Pilih kelas</option>{classes.map((item) => <option key={item} value={item}>{item}</option>)}</select> : <input value={className} onChange={(event) => { setClassName(event.target.value); setError(""); }} placeholder={role === "Guru" ? "Contoh: Guru Bahasa Indonesia" : "Contoh: Admin Perpustakaan"} />}</label><label>Username <small>(opsional)</small><input value={username} onChange={(event) => { setUsername(event.target.value); setError(""); }} placeholder={createMemberUsername(name) || "Otomatis dibuat dari nama"} /></label><label>Password <small>(opsional)</small><input value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} placeholder="Otomatis dibuat saat disimpan" /></label></div>{error && <div className="form-error"><Icon name="alert" size={16} />{error}</div>}{avatarError && <div className="form-error"><Icon name="alert" size={16} />{avatarError}</div>}<div className="loan-note"><Icon name="check" size={17} /><span>Jika dikosongkan, username dan password akan dibuat otomatis dan dapat diunduh dari tabel anggota.</span></div><div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Batal</button><button type="submit" className="button button-primary" disabled={saving || avatarReading}>{saving ? "Menyimpan..." : "Tambah anggota"}</button></div></form></div>{cropSource && <AvatarCropModal imageUrl={cropSource} preview={{ name: name.trim(), role, detail: role === "Siswa" ? className : className.trim(), code: nextCodes[role], color: colors[existingMembers.length % colors.length] }} onCancel={() => setCropSource(null)} onConfirm={confirmCrop} />}</div>;
}

function EditMemberModal({ member, existingMembers, classes, onClose, onSave }: { member: Member; existingMembers: Member[]; classes: string[]; onClose: () => void; onSave: (member: Member) => void }) {
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState<MemberRole>(member.role);
  const [className, setClassName] = useState(member.className);
  const [username, setUsername] = useState(member.username);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(member.status === "Nonaktif" ? "Nonaktif" : "Aktif");
  const [error, setError] = useState("");
  const [avatarData, setAvatarData] = useState<string | undefined>(member.avatarData);
  const [avatarName, setAvatarName] = useState<string | undefined>(member.avatarName);
  const [avatarError, setAvatarError] = useState("");
  const [avatarReading, setAvatarReading] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const selectRole = (nextRole: MemberRole) => { setRole(nextRole); setClassName(nextRole === "Siswa" ? (classes.includes(className) ? className : classes[0] ?? "") : ""); setError(""); };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setAvatarError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("Foto anggota harus berupa file gambar.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError("Ukuran foto maksimal 2 MB.");
      return;
    }
    const reader = new FileReader();
    setAvatarReading(true);
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
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

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedClassName = className.trim();
    const nextUsername = username.trim().toLowerCase();
    if (!trimmedName || !trimmedClassName || !nextUsername) {
      setError("Lengkapi nama, kelas atau jabatan, dan username terlebih dahulu.");
      return;
    }
    if (nextUsername !== member.username.toLowerCase() && existingMembers.some((item) => item.code !== member.code && item.username.toLowerCase() === nextUsername)) {
      setError("Username sudah digunakan oleh anggota lain.");
      return;
    }
    onSave({ ...member, name: trimmedName, className: trimmedClassName, role, username: nextUsername, password: password.trim() || member.password, status, initials: getInitials(trimmedName), avatarData, avatarName });
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-member-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">DATA ANGGOTA</span><h2 id="edit-member-title">Edit anggota</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Tutup"><Icon name="close" size={20} /></button></div><form onSubmit={submit}><div className="form-grid"><div className="form-span member-avatar-row"><span className="avatar member-avatar-preview" style={{ backgroundColor: member.color }}>{avatarData ? <img src={avatarData} alt="Pratinjau foto anggota" /> : member.initials}</span><span className="member-avatar-controls"><b>Foto anggota <small>(opsional)</small></b><span className="avatar-actions"><label className="avatar-upload-label"><input className="file-input" type="file" accept="image/*" onChange={handleAvatarChange} /><span className="text-button avatar-upload-button"><Icon name="upload" size={13} />{avatarReading ? "Memproses..." : avatarData ? "Ganti foto" : "Upload foto"}</span></label>{avatarData && <button type="button" className="text-button avatar-remove-button" onClick={() => { setAvatarData(undefined); setAvatarName(undefined); setAvatarError(""); }}>Hapus foto</button>}</span></span></div><label className="form-span">Nama lengkap<input autoFocus value={name} onChange={(event) => { setName(event.target.value); setError(""); }} /></label><label>Peran<select value={role} onChange={(event) => selectRole(event.target.value as MemberRole)}><option value="Siswa">Siswa</option><option value="Guru">Guru</option><option value="Admin">Admin</option></select></label><label>Kode anggota<input value={member.code} readOnly /></label><label className="form-span">{role === "Siswa" ? "Kelas" : "Jabatan"}{role === "Siswa" ? <select value={className} onChange={(event) => { setClassName(event.target.value); setError(""); }}><option value="">Pilih kelas</option>{Array.from(new Set([className, ...classes].filter(Boolean))).map((item) => <option key={item} value={item}>{item}</option>)}</select> : <input value={className} onChange={(event) => { setClassName(event.target.value); setError(""); }} />}</label><label>Username<input value={username} onChange={(event) => { setUsername(event.target.value); setError(""); }} /></label><label>Password baru <small>(opsional)</small><input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Kosongkan untuk mempertahankan password" /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="Aktif">Aktif</option><option value="Nonaktif">Nonaktif</option></select></label></div>{error && <div className="form-error"><Icon name="alert" size={16} />{error}</div>}{avatarError && <div className="form-error"><Icon name="alert" size={16} />{avatarError}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Batal</button><button type="submit" className="button button-primary" disabled={avatarReading}>{avatarReading ? "Memproses foto..." : "Simpan perubahan"}</button></div></form></div>{cropSource && <AvatarCropModal imageUrl={cropSource} preview={{ name: name.trim() || member.name, role, detail: role === "Siswa" ? className : className.trim(), code: member.code, color: member.color }} onCancel={() => setCropSource(null)} onConfirm={confirmCrop} />}</div>;
}

function AddClassModal({ classes, onClose, onAdd, onDelete, onConfirm }: { classes: string[]; onClose: () => void; onAdd: (name: string) => boolean; onDelete: (name: string) => boolean; onConfirm: (request: Omit<ConfirmRequest, "onConfirm"> & { onConfirm: () => void }) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized) {
      setError("Masukkan nama kelas terlebih dahulu.");
      return;
    }
    if (!onAdd(normalized)) {
      setError("Kelas sudah tersedia.");
      return;
    }
    onClose();
  };

  const removeClass = (className: string) => {
    onConfirm({ title: "Hapus kelas", message: `Hapus kelas “${className}”?`, confirmLabel: "Hapus kelas", danger: true, onConfirm: () => {
      if (!onDelete(className)) {
        setError(`Kelas “${className}” masih digunakan oleh Siswa.`);
        return;
      }
      setError("");
    }});
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="class-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">DATA KELAS</span><h2 id="class-title">Tambah Kelas</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Tutup"><Icon name="close" size={20} /></button></div><form onSubmit={submit}><label className="standalone-form-label">Nama kelas<input autoFocus value={name} onChange={(event) => { setName(event.target.value); setError(""); }} placeholder="Contoh: XII IPS 2" /></label>{error && <div className="form-error"><Icon name="alert" size={16} />{error}</div>}<p className="class-help">Kelas tersimpan: {classes.length}. Kelas yang sedang digunakan Siswa tidak dapat dihapus.</p><div className="category-list class-list">{classes.map((item) => <div className="category-item" key={item}><span>{item}</span><button type="button" className="text-button category-delete" onClick={() => removeClass(item)}>Hapus</button></div>)}</div><div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Batal</button><button type="submit" className="button button-primary"><Icon name="plus" size={16} /> Tambah Kelas</button></div></form></div></div>;
}

function ImportStudentsModal({ classes, onClose, onImport }: { classes: string[]; onClose: () => void; onImport: (rows: StudentImportRow[]) => StudentImportSummary }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<StudentImportRow[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setError("");
    setSuccess("");
    setRows([]);
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setFileName("");
      setError("File harus berformat .xlsx atau .xls.");
      event.target.value = "";
      return;
    }
    setFileName(file.name);
    setReading(true);
    try {
      setRows(await parseStudentWorkbook(file));
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "File Excel tidak dapat dibaca.");
      setFileName("");
      event.target.value = "";
    } finally {
      setReading(false);
    }
  };

  const submit = () => {
    if (rows.length === 0) {
      setError("Pilih file Excel yang berisi data siswa terlebih dahulu.");
      return;
    }
    const result = onImport(rows);
    if (result.added > 0) setSuccess(`${result.added} siswa berhasil ditambahkan.`);
    if (result.errors.length > 0) {
      setError(result.errors.join(" "));
      setRows([]);
      return;
    }
    onClose();
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal import-modal" role="dialog" aria-modal="true" aria-labelledby="import-students-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">IMPORT DATA MASSAL</span><h2 id="import-students-title">Import siswa dari XLSX</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Tutup"><Icon name="close" size={20} /></button></div><div className="import-instructions"><strong>Format file</strong><span>Gunakan template XLSX agar nama kolom dan kelas sesuai.</span><span><b>Nama Siswa</b> dan <b>Kelas</b> wajib diisi. Username dan password boleh kosong.</span><span>Isi Kelas persis seperti daftar pada sheet <b>Referensi Kelas</b>.</span><span>Kelas tersedia saat ini: <b>{classes.length}</b>. Tambahkan kelas baru terlebih dahulu melalui menu Tambah Kelas.</span></div><label className="form-span file-upload-label"><input className="file-input" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={handleFileChange} /><span className="file-upload-box"><Icon name={reading ? "clock" : "upload"} size={17} /><span>{reading ? "Membaca file..." : fileName || "Pilih file XLSX atau XLS"}<small>{fileName ? `${rows.length} baris siswa siap divalidasi` : "Gunakan satu file untuk satu kelas atau beberapa kelas"}</small></span></span></label>{error && <div className="form-error import-error"><Icon name="alert" size={16} />{error}</div>}{success && <div className="import-success"><Icon name="check" size={16} />{success}</div>}{rows.length > 0 && <div className="import-preview"><strong>Pratinjau data ({rows.length} siswa)</strong><div className="import-preview-list">{rows.slice(0, 5).map((row) => <span key={row.rowNumber}>{row.name || "Nama kosong"} · {row.className || "Kelas kosong"}</span>)}{rows.length > 5 && <small>+{rows.length - 5} baris lainnya</small>}</div></div>}<div className="loan-note"><Icon name="check" size={17} /><span>Peran otomatis <b>Siswa</b>, status otomatis <b>Aktif</b>, kode anggota dibuat sistem, dan akun otomatis dibuat jika dikosongkan.</span></div><div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Batal</button><button type="button" className="button button-primary" onClick={submit} disabled={reading || rows.length === 0}>Import {rows.length > 0 ? `${rows.length} siswa` : "siswa"}</button></div></div></div>;
}

function generateRandomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let result = "";
  for (let i = 0; i < 10; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function MembersPage({ membersList, classes, onAdd, onEdit, onDelete, onAddClass, onImportStudents, onDownloadTemplate, onResetPassword }: { membersList: Member[]; classes: string[]; onAdd: () => void; onEdit: (member: Member) => void; onDelete: (member: Member) => void; onAddClass: () => void; onImportStudents: () => void; onDownloadTemplate: () => void; onResetPassword: (member: Member, newPassword: string) => void }) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"Semua" | MemberRole>("Semua");
  const [showPasswords, setShowPasswords] = useState<Set<string>>(new Set());
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const roleTabs: ("Semua" | MemberRole)[] = ["Semua", "Admin", "Guru", "Siswa"];
  const filtered = membersList.filter((member) => {
    const matchesSearch = `${member.name} ${member.code} ${member.className} ${member.username}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (roleFilter === "Semua" || member.role === roleFilter);
  });
  const downloadFilteredAccounts = () => {
    const csv = ["Nama,Peran,Kode,Kelas/Jabatan,Username,Password,Status", ...filtered.map((member) => [member.name, member.role, member.code, member.className, member.username, member.password, member.status].map(csvCell).join(","))].join("\n");
    downloadTextFile(`akun-${roleFilter.toLowerCase()}-al-haytham.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
  };
  const togglePassword = (code: string) => {
    setShowPasswords((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };
  const copyCredential = (member: Member) => {
    const text = `Username: ${member.username}\nPassword: ${member.password}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCode(member.code);
      setTimeout(() => setCopiedCode(null), 1800);
    }).catch(() => undefined);
  };
  const handleResetPassword = (member: Member) => {
    const newPassword = generateRandomPassword();
    onResetPassword(member, newPassword);
  };
  return <><PageHeader title="Anggota perpustakaan" description="Kelola Admin, Guru, dan Siswa serta unduh akun dan kartu anggota." action={<div className="member-page-actions"><button className="button button-outline" onClick={downloadFilteredAccounts}><Icon name="download" size={16} /> Unduh akun</button><button className="button button-primary" onClick={onAdd}><Icon name="plus" size={17} /> Tambah anggota</button></div>} /><div className="member-tabs" role="tablist" aria-label="Kelompok anggota">{roleTabs.map((role) => <button type="button" role="tab" aria-selected={roleFilter === role} key={role} onClick={() => setRoleFilter(role)} className={roleFilter === role ? "member-tab active" : "member-tab"}>{role}<span>{role === "Semua" ? membersList.length : membersList.filter((member) => member.role === role).length}</span></button>)}</div><div className="toolbar member-toolbar"><label className="search-box"><Icon name="search" size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cari nama, kode, atau username..." /></label><div className="member-toolbar-actions"><span className="member-result-count">{filtered.length} akun tampil</span>{roleFilter === "Siswa" && <div className="member-import-actions"><button type="button" className="button button-outline add-class-button" onClick={onDownloadTemplate}><Icon name="download" size={15} /> Template XLSX</button><button type="button" className="button button-outline add-class-button" onClick={onImportStudents}><Icon name="upload" size={15} /> Import Siswa</button><button type="button" className="button button-outline add-class-button" onClick={onAddClass}><Icon name="plus" size={15} /> Tambah Kelas</button></div>}</div></div><section className="panel full-table-panel"><div className="table-scroll"><table className="members-table"><thead><tr><th>Nama anggota</th><th>Peran</th><th>Kode</th><th>Kelas / Jabatan</th><th>Username</th><th>Password</th><th>Bergabung</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{filtered.map((member) => { const isPasswordVisible = showPasswords.has(member.code); const isCopied = copiedCode === member.code; return <tr key={member.code}><td><div className="person"><span className="avatar" style={{ backgroundColor: member.color }}>{member.avatarData ? <img src={member.avatarData} alt={`Foto ${member.name}`} /> : member.initials}</span><span><b>{member.name}</b></span></div></td><td><span className={`role-pill role-${member.role.toLowerCase()}`}>{member.role}</span></td><td className="muted-cell">{member.code}</td><td>{member.className}</td><td className="credential-cell"><span className="credential-text">{member.username}</span></td><td className="credential-cell"><div className="credential-password"><span className="credential-text">{isPasswordVisible ? member.password : "••••••••"}</span><button type="button" className="password-toggle" onClick={() => togglePassword(member.code)} title={isPasswordVisible ? "Sembunyikan password" : "Tampilkan password"} aria-label={isPasswordVisible ? "Sembunyikan password" : "Tampilkan password"}>{isPasswordVisible ? "🙈" : "👁️"}</button></div></td><td>{member.joined}</td><td><StatusPill status={member.status} /></td><td><div className="member-downloads"><button type="button" className="member-download" onClick={() => onEdit(member)} aria-label={`Edit ${member.name}`} title="Edit anggota"><Icon name="edit" size={14} /></button><button type="button" className="member-download" onClick={() => copyCredential(member)} aria-label={`Salin akun ${member.name}`} title="Salin username & password"><Icon name="user" size={14} /></button>{isCopied && <span className="copy-feedback">Tersalin!</span>}<button type="button" className="member-download" onClick={() => handleResetPassword(member)} aria-label={`Reset password ${member.name}`} title="Reset password"><Icon name="repeat" size={14} /></button><button type="button" className="member-download" onClick={() => downloadMemberAccount(member)} aria-label={`Unduh akun ${member.name}`} title="Unduh akun"><Icon name="download" size={14} /></button><button type="button" className="member-download" onClick={() => downloadMemberCard(member)} aria-label={`Unduh kartu ${member.name}`} title="Unduh kartu"><Icon name="card" size={14} /></button><button type="button" className="member-download member-delete" onClick={() => onDelete(member)} aria-label={`Hapus ${member.name}`} title="Hapus anggota"><Icon name="trash" size={14} /></button></div></td></tr>; })}</tbody></table></div>{filtered.length === 0 && <div className="empty-state member-empty"><Icon name="search" size={30} /><h3>Anggota tidak ditemukan</h3><p>Coba ubah pencarian atau kelompok anggota.</p></div>}<div className="pagination"><span>Menampilkan 1–{filtered.length} dari {filtered.length} akun</span><div><button className="page-number active">1</button></div></div></section></>;
}

function LoansPage({ loansList, membersList, onQuickLoan, onReturnLoan }: { loansList: Loan[]; membersList: Member[]; onQuickLoan: () => void; onReturnLoan: (loan: Loan) => void }) {
  const memberMap = new Map(membersList.map((m) => [m.code, m]));
  const [tab, setTab] = useState("Semua");
  const tabs = ["Semua", "Dipinjam", "Terlambat", "Dikembalikan"];
  const filtered = loansList.filter((loan) => tab === "Semua" || getLoanStatus(loan) === tab);
  const activeCount = loansList.filter((loan) => getLoanStatus(loan) === "Dipinjam").length;
  const overdueCount = loansList.filter((loan) => getLoanStatus(loan) === "Terlambat").length;
  const returnedCount = loansList.filter((loan) => getLoanStatus(loan) === "Dikembalikan").length;
  return <><PageHeader title="Peminjaman" description="Pantau transaksi peminjaman dan pengembalian buku." action={<button className="button button-primary" onClick={onQuickLoan}><Icon name="plus" size={17} /> Peminjaman baru</button>} /><div className="summary-strip"><div><span className="mini-icon orange"><Icon name="repeat" size={16} /></span><span><b>{activeCount}</b><small>Sedang dipinjam</small></span></div><div><span className="mini-icon red"><Icon name="clock" size={16} /></span><span><b>{overdueCount}</b><small>Terlambat</small></span></div><div><span className="mini-icon green"><Icon name="check" size={16} /></span><span><b>{returnedCount}</b><small>Dikembalikan</small></span></div></div><section className="panel full-table-panel"><div className="loan-toolbar"><div className="tabs">{tabs.map((item) => <button key={item} onClick={() => setTab(item)} className={tab === item ? "tab active" : "tab"}>{item}{item === "Terlambat" && <span className="tab-count">{overdueCount}</span>}</button>)}</div><label className="date-button"><Icon name="calendar" size={16} /> Semua transaksi <Icon name="chevron" size={14} /></label></div><div className="table-scroll"><table><thead><tr><th>Anggota</th><th>Judul buku</th><th>Tanggal pinjam</th><th>Jatuh tempo</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{filtered.map((loan) => { const status = getLoanStatus(loan); const memberAvatar = memberMap.get(loan.memberCode)?.avatarData; return <tr key={loan.id}><td><div className="person"><span className="avatar" style={{ backgroundColor: loan.color }}>{memberAvatar ? <img src={memberAvatar} alt={`Foto ${loan.member}`} /> : loan.avatar}</span><b>{loan.member}</b></div></td><td>{loan.book}</td><td>{loan.borrowed}</td><td className={status === "Terlambat" ? "late-text" : ""}>{loan.due}</td><td><StatusPill status={status} /></td><td>{status === "Dikembalikan" ? <span className="muted-cell">Selesai</span> : <button type="button" className="member-download loan-return-button" onClick={() => onReturnLoan(loan)}><Icon name="check" size={13} /> Kembalikan</button>}</td></tr>; })}</tbody></table></div>{filtered.length === 0 && <div className="empty-state member-empty"><Icon name="repeat" size={30} /><h3>Transaksi tidak ditemukan</h3><p>Coba pilih tab transaksi lain.</p></div>}</section></>;
}

function ReportsPage({ booksList, membersList, loansList }: { booksList: Book[]; membersList: Member[]; loansList: Loan[] }) {
  const [period, setPeriod] = useState<"week" | "month">("week");

  // --- Summary stats ---
  const totalLoans = loansList.length;
  const activeLoans = loansList.filter((loan) => getLoanStatus(loan) === "Dipinjam").length;
  const overdueLoans = loansList.filter((loan) => getLoanStatus(loan) === "Terlambat").length;
  const returnedLoans = loansList.filter((loan) => getLoanStatus(loan) === "Dikembalikan").length;
  const totalBooks = booksList.length;
  const totalStock = booksList.reduce((sum, book) => sum + book.stock, 0);
  const totalAvailable = booksList.reduce((sum, book) => sum + book.available, 0);
  const totalMembers = membersList.length;
  const activeMembers = membersList.filter((member) => member.status === "Aktif").length;

  // --- Popular books (by loan count) ---
  const loanCountByBook = new Map<string, number>();
  for (const loan of loansList) loanCountByBook.set(loan.bookCode, (loanCountByBook.get(loan.bookCode) ?? 0) + 1);
  const popularBooks = [...booksList]
    .map((book) => ({ ...book, loanCount: loanCountByBook.get(book.code) ?? 0 }))
    .sort((a, b) => b.loanCount - a.loanCount)
    .slice(0, 6);
  const maxBookLoans = Math.max(...popularBooks.map((book) => book.loanCount), 1);

  // --- Active members (by loan count) ---
  const loanCountByMember = new Map<string, number>();
  for (const loan of loansList) loanCountByMember.set(loan.memberCode, (loanCountByMember.get(loan.memberCode) ?? 0) + 1);
  const activeMembersList = [...membersList]
    .filter((member) => loanCountByMember.has(member.code))
    .map((member) => ({ ...member, loanCount: loanCountByMember.get(member.code) ?? 0 }))
    .sort((a, b) => b.loanCount - a.loanCount)
    .slice(0, 6);
  const maxMemberLoans = Math.max(...activeMembersList.map((member) => member.loanCount), 1);

  // --- Loan distribution by day-of-week (simplified chart) ---
  const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const loansByDay = dayNames.map((name, index) => ({ name, count: loansList.filter((loan) => {
    const d = new Date(loan.borrowedDate ?? "");
    return d.getDay() === index;
  }).length }));
  const maxDayLoans = Math.max(...loansByDay.map((d) => d.count), 1);

  // --- Loan status distribution ---
  const statusData = [
    { label: "Dipinjam", count: activeLoans, color: "green" },
    { label: "Terlambat", count: overdueLoans, color: "orange" },
    { label: "Dikembalikan", count: returnedLoans, color: "blue" },
  ];
  const maxStatusCount = Math.max(...statusData.map((s) => s.count), 1);

  // --- Export CSV ---
  const exportLoansCsv = () => {
    const header = "ID Anggota,Nama Anggota,Kode Buku,Judul Buku,Tanggal Pinjam,Jatuh Tempo,Status\n";
    const rows = loansList.map((loan) => [loan.memberCode, loan.member, loan.bookCode, loan.book, loan.borrowed, loan.due, getLoanStatus(loan)].map(csvCell).join(",")).join("\n");
    downloadTextFile(`laporan-peminjaman-${dateInputValue()}.csv`, `\ufeff${header}${rows}`, "text/csv;charset=utf-8");
  };

  const exportBooksCsv = () => {
    const header = "Kode,Judul,Penulis,Kategori,Stok,Tersedia\n";
    const rows = booksList.map((book) => [book.code, book.title, book.author, book.category, String(book.stock), String(book.available)].map(csvCell).join(",")).join("\n");
    downloadTextFile(`laporan-koleksi-buku-${dateInputValue()}.csv`, `\ufeff${header}${rows}`, "text/csv;charset=utf-8");
  };

  return <>
    <PageHeader title="Laporan & Analitik" description="Pantau tren aktivitas perpustakaan dan unduh laporan." action={<div className="member-page-actions"><button className="button button-outline" onClick={exportBooksCsv}><Icon name="download" size={16} /> Koleksi buku</button><button className="button button-primary" onClick={exportLoansCsv}><Icon name="download" size={16} /> Peminjaman</button></div>} />

    {/* Summary cards */}
    <div className="stat-grid">
      <StatCard icon="repeat" label="Total transaksi" value={String(totalLoans)} change={`${activeLoans} aktif`} context="semua peminjaman" up accent="green" />
      <StatCard icon="book" label="Koleksi buku" value={String(totalBooks)} change={`${totalStock} total stok`} context={`${totalAvailable} tersedia`} up accent="blue" />
      <StatCard icon="users" label="Anggota aktif" value={String(activeMembers)} change={`${totalMembers} terdaftar`} context="data anggota" up accent="orange" />
      <StatCard icon="alert" label="Terlambat" value={String(overdueLoans)} change={`${returnedLoans} dikembalikan`} context="perlu ditindak" up={overdueLoans === 0} accent="red" />
    </div>

    <div className="reports-grid">
      {/* Loan status distribution */}
      <section className="panel">
        <div className="panel-heading"><div><h2>Distribusi status peminjaman</h2><p>Persentase transaksi berdasarkan status saat ini</p></div></div>
        <div className="reports-bar-chart">
          {statusData.map((item) => <div className="reports-bar-row" key={item.label}>
            <span className="reports-bar-label">{item.label}</span>
            <div className="reports-bar-track"><div className={`reports-bar-fill ${item.color}`} style={{ width: `${Math.max(8, (item.count / maxStatusCount) * 100)}%` }} /></div>
            <span className="reports-bar-value"><strong>{item.count}</strong> transaksi</span>
          </div>)}
        </div>
      </section>

      {/* Loans by day of week */}
      <section className="panel">
        <div className="panel-heading"><div><h2>Peminjaman per hari</h2><p>Distribusi peminjaman berdasarkan hari dalam minggu</p></div></div>
        <div className="reports-column-chart">
          {loansByDay.map((day) => <div className="reports-column" key={day.name}>
            <span className="reports-column-value">{day.count}</span>
            <div className="reports-column-bar" style={{ height: `${Math.max(8, (day.count / maxDayLoans) * 100)}%` }} />
            <span className="reports-column-label">{day.name}</span>
          </div>)}
        </div>
      </section>

      {/* Popular books */}
      <section className="panel">
        <div className="panel-heading"><div><h2>Buku paling populer</h2><p>Berdasarkan jumlah transaksi peminjaman</p></div></div>
        <div className="reports-popular-list">
          {popularBooks.map((book, index) => <div className="reports-popular-item" key={book.code}>
            <span className="reports-rank">{index + 1}</span>
            <BookCover book={book} small />
            <div className="reports-popular-info"><b>{book.title}</b><span>{book.author}</span></div>
            <span className="reports-popular-count"><strong>{book.loanCount}</strong>x</span>
          </div>)}
          {popularBooks.length === 0 && <div className="empty-state" style={{ minHeight: 120 }}><Icon name="book" size={24} /><h3>Belum ada data peminjaman</h3></div>}
        </div>
      </section>

      {/* Active members */}
      <section className="panel">
        <div className="panel-heading"><div><h2>Anggota paling aktif</h2><p>Peminjam terbanyak dalam periode ini</p></div></div>
        <div className="reports-popular-list">
          {activeMembersList.map((member, index) => <div className="reports-popular-item" key={member.code}>
            <span className="reports-rank">{index + 1}</span>
            <span className="avatar reports-member-avatar" style={{ backgroundColor: member.color }}>{member.avatarData ? <img src={member.avatarData} alt={`Foto ${member.name}`} /> : member.initials}</span>
            <div className="reports-popular-info"><b>{member.name}</b><span>{member.className}</span></div>
            <span className="reports-popular-count"><strong>{member.loanCount}</strong>x</span>
          </div>)}
          {activeMembersList.length === 0 && <div className="empty-state" style={{ minHeight: 120 }}><Icon name="users" size={24} /><h3>Belum ada data peminjaman</h3></div>}
        </div>
      </section>
    </div>
  </>;
}

function SettingsPage({ categories, avatarShape, onAvatarShapeChange, themeMode, onThemeModeChange, onAddCategory, onDeleteCategory, libraryName, adminEmail, loanDuration, dueDateReminder, lowStockReminder, timezone, onSaveSettings }: { categories: string[]; avatarShape: "round" | "square"; onAvatarShapeChange: (shape: "round" | "square") => void; themeMode: ThemeMode; onThemeModeChange: (mode: ThemeMode) => void; onAddCategory: (name: string) => boolean; onDeleteCategory: (name: string) => boolean; libraryName: string; adminEmail: string; loanDuration: string; dueDateReminder: boolean; lowStockReminder: boolean; timezone: string; onSaveSettings: (data: { libraryName: string; adminEmail: string; loanDuration: string; dueDateReminder: boolean; lowStockReminder: boolean; timezone: string }) => void }) {
  const [draftLibraryName, setDraftLibraryName] = useState(libraryName);
  const [draftAdminEmail, setDraftAdminEmail] = useState(adminEmail);
  const [draftLoanDuration, setDraftLoanDuration] = useState(loanDuration);
  const [draftDueDateReminder, setDraftDueDateReminder] = useState(dueDateReminder);
  const [draftLowStockReminder, setDraftLowStockReminder] = useState(lowStockReminder);
  const [draftTimezone, setDraftTimezone] = useState(timezone);
  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [saved, setSaved] = useState(false);

  const saveSettings = () => {
    onSaveSettings({ libraryName: draftLibraryName, adminEmail: draftAdminEmail, loanDuration: draftLoanDuration, dueDateReminder: draftDueDateReminder, lowStockReminder: draftLowStockReminder, timezone: draftTimezone });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  const addCategory = () => {
    const name = categoryName.trim();
    if (!name) {
      setCategoryError("Masukkan nama kategori terlebih dahulu.");
      return;
    }
    if (!onAddCategory(name)) {
      setCategoryError("Kategori sudah tersedia atau tidak valid.");
      return;
    }
    setCategoryName("");
    setCategoryError("");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  const deleteCategory = (name: string) => {
    if (!onDeleteCategory(name)) {
      setCategoryError(`Kategori “${name}” masih digunakan oleh koleksi buku atau E-Book.`);
      return;
    }
    setCategoryError("");
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  return <>
    <PageHeader title="Pengaturan" description="Kelola profil perpustakaan, kategori, dan preferensi admin portal." />
    <div className="settings-grid">
      <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>Profil perpustakaan</h2><p>Informasi dasar yang digunakan di admin portal.</p></div></div>
        <div className="form-grid settings-form">
          <label>Nama perpustakaan<input value={draftLibraryName} onChange={(event) => { setDraftLibraryName(event.target.value); setSaved(false); }} /></label>
          <label>Email administrator<input type="email" value={draftAdminEmail} onChange={(event) => { setDraftAdminEmail(event.target.value); setSaved(false); }} /></label>
          <label>Durasi peminjaman<select value={draftLoanDuration} onChange={(event) => { setDraftLoanDuration(event.target.value); setSaved(false); }}><option value="3">3 hari</option><option value="7">7 hari</option><option value="14">14 hari</option></select></label>
          <label>Zona waktu<select value={draftTimezone} onChange={(event) => { setDraftTimezone(event.target.value); setSaved(false); }}><option>WIB (UTC+7)</option><option>WITA (UTC+8)</option><option>WIT (UTC+9)</option></select></label>
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>Preferensi notifikasi</h2><p>Atur pengingat untuk aktivitas penting.</p></div></div>
        <label className="settings-toggle"><span><b>Pengingat jatuh tempo</b><small>Tampilkan peminjaman yang mendekati jatuh tempo.</small></span><input type="checkbox" checked={draftDueDateReminder} onChange={(event) => { setDraftDueDateReminder(event.target.checked); setSaved(false); }} /></label>
        <label className="settings-toggle"><span><b>Peringatan stok menipis</b><small>Beritahu saat stok buku kurang dari 2.</small></span><input type="checkbox" checked={draftLowStockReminder} onChange={(event) => { setDraftLowStockReminder(event.target.checked); setSaved(false); }} /></label>
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>Pengaturan tampilan</h2><p>Pilih bentuk avatar untuk foto anggota dan profil.</p></div></div>
        <div className="avatar-shape-options">
          <button type="button" className={`avatar-shape-option ${avatarShape === "round" ? "active" : ""}`} onClick={() => { onAvatarShapeChange("round"); setSaved(false); }}><span className="avatar-shape-demo round"><span>RN</span></span><span><b>Bulat</b><small>Bentuk avatar lingkaran penuh</small></span></button>
          <button type="button" className={`avatar-shape-option ${avatarShape === "square" ? "active" : ""}`} onClick={() => { onAvatarShapeChange("square"); setSaved(false); }}><span className="avatar-shape-demo square"><span>RN</span></span><span><b>Persegi</b><small>Sudut membulat, tampilan modern</small></span></button>
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading"><div><h2>Tema tampilan</h2><p>Pilih tema terang, gelap, atau ikuti pengaturan perangkat.</p></div></div>
        <div className="avatar-shape-options">
          <button type="button" className={`theme-option ${themeMode === "auto" ? "active" : ""}`} onClick={() => { onThemeModeChange("auto"); setSaved(false); }}><span className="theme-option-demo demo-auto" /><span><b>Otomatis</b><small>Ikuti pengaturan terang/gelap perangkat</small></span></button>
          <button type="button" className={`theme-option ${themeMode === "light" ? "active" : ""}`} onClick={() => { onThemeModeChange("light"); setSaved(false); }}><span className="theme-option-demo demo-light" /><span><b>Terang</b><small>Tampilan default dengan latar cerah</small></span></button>
          <button type="button" className={`theme-option ${themeMode === "dark" ? "active" : ""}`} onClick={() => { onThemeModeChange("dark"); setSaved(false); }}><span className="theme-option-demo demo-dark" /><span><b>Gelap</b><small>Mata lebih nyaman di ruangan minim cahaya</small></span></button>
        </div>
      </section>
      <section className="panel settings-panel category-settings-panel">
        <div className="panel-heading"><div><h2>Pengaturan kategori</h2><p>Tambahkan kategori yang dapat dipilih saat membuat buku atau E-Book.</p></div></div>
        <div className="category-add-row"><input value={categoryName} onChange={(event) => { setCategoryName(event.target.value); setCategoryError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCategory(); } }} placeholder="Contoh: Sejarah" aria-label="Nama kategori baru" /><button type="button" className="button button-primary" onClick={addCategory}><Icon name="plus" size={16} /> Tambah kategori</button></div>
        {categoryError && <div className="form-error category-error"><Icon name="alert" size={16} />{categoryError}</div>}
        <div className="category-list">{categories.map((category) => <div className="category-item" key={category}><span>{category}</span><button type="button" className="text-button category-delete" onClick={() => deleteCategory(category)}>Hapus</button></div>)}</div>
      </section>
    </div>
    <div className="settings-actions"><span className={saved ? "settings-saved" : "settings-saved hidden"}>Perubahan tersimpan.</span><button className="button button-primary" onClick={saveSettings}>Simpan perubahan</button></div>
  </>;
}

function ProfileModal({ profile, onClose, onSave, onLogout }: { profile: ProfileData; onClose: () => void; onSave: (profile: ProfileData) => void; onLogout: () => void }) {
  const [draft, setDraft] = useState(profile);
  const [avatarError, setAvatarError] = useState("");
  const [avatarReading, setAvatarReading] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [nameError, setNameError] = useState("");

  const updateText = (field: "name" | "email" | "phone" | "bio" | "detail", value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (field === "name") setNameError(value.trim().length < 2 ? "Nama harus minimal 2 karakter." : "");
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    setAvatarError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("Foto profil harus berupa file gambar.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarError("Ukuran foto maksimal 2 MB.");
      return;
    }
    const reader = new FileReader();
    setAvatarReading(true);
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : null;
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
    setDraft((current) => ({ ...current, avatarData: dataUrl, avatarName: "avatar-cropped.jpg" }));
    setCropSource(null);
  };

  const removeAvatar = () => {
    setDraft((current) => ({ ...current, avatarData: undefined, avatarName: undefined }));
    setAvatarError("");
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">PROFIL AKUN</span><h2 id="profile-title">Edit profil</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Tutup profil"><Icon name="close" size={20} /></button></div><div className="profile-identity"><span className="profile-avatar-large">{draft.avatarData ? <img key={draft.avatarData} src={draft.avatarData} alt={`Foto ${draft.name || "pengguna"}`} /> : getInitials(draft.name)}</span><div><strong>{draft.name || "Nama pengguna"}</strong><small>{draft.role === "student" ? "Siswa / Anggota" : "Pengelola perpustakaan"}</small><div className="avatar-actions"><label className="avatar-upload-label"><input className="file-input" type="file" accept="image/*" onChange={handleAvatarChange} /><span className="text-button avatar-upload-button"><Icon name="upload" size={13} />{avatarReading ? "Memproses..." : draft.avatarData ? "Ganti foto" : "Upload foto"}</span></label>{draft.avatarData && <button type="button" className="text-button avatar-remove-button" onClick={removeAvatar}>Hapus foto</button>}</div></div></div>{avatarError && <div className="form-error"><Icon name="alert" size={16} />{avatarError}</div>}<form onSubmit={(event) => { event.preventDefault(); if (!avatarReading) onSave(draft); }}><div className="form-grid profile-form-grid"><label>Nama lengkap<input value={draft.name} onChange={(event) => updateText("name", event.target.value)} placeholder="Masukkan nama lengkap" style={nameError ? { borderColor: "#e07060" } : undefined} />{nameError && <span className="form-error" style={{ fontSize: 10, marginTop: 4 }}><Icon name="alert" size={14} />{nameError}</span>}</label><label>Email<input type="email" value={draft.email} onChange={(event) => updateText("email", event.target.value)} placeholder="nama@contoh.id" /></label><label>Nomor telepon<input value={draft.phone} onChange={(event) => updateText("phone", event.target.value)} placeholder="Contoh: 0812 3456 7890" /></label><label>Jenis profil<select value={draft.role} onChange={(event) => { const role = event.target.value as ProfileRole; setDraft((current) => ({ ...current, role, detail: role === "student" ? "XI IPA 2" : "Administrator" })); }}><option value="staff">Pengelola</option><option value="student">Siswa</option></select></label><label>{draft.role === "student" ? "Kelas / kode anggota" : "Jabatan"}<input value={draft.detail} onChange={(event) => updateText("detail", event.target.value)} placeholder={draft.role === "student" ? "Contoh: XI IPA 2 / AG-2024-001" : "Contoh: Administrator"} /></label><label className="profile-bio">Bio singkat<textarea value={draft.bio} onChange={(event) => updateText("bio", event.target.value)} placeholder="Ceritakan sedikit tentang diri Anda..." rows={4} maxLength={160} /></label></div><div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Batal</button><button type="submit" className="button button-primary" disabled={avatarReading || nameError.length > 0 || draft.name.trim().length < 2}>{avatarReading ? "Memproses foto..." : "Simpan profil"}</button></div></form><div className="profile-modal-footer"><button type="button" className="profile-logout" onClick={onLogout}><Icon name="logout" size={13} /> Keluar</button></div></div>{cropSource && <AvatarCropModal imageUrl={cropSource} preview={{ name: draft.name.trim(), role: draft.role === "student" ? "Siswa" : "Pengelola", detail: draft.detail.trim(), code: draft.role === "student" ? "AG-2024-001" : "ADM-001", color: "#cfe4da" }} onCancel={() => setCropSource(null)} onConfirm={confirmCrop} />}</div>;
}

const notifications: { title: string; detail: string; time: string; icon: IconName; page: PageKey }[] = [
  { title: "12 peminjaman terlambat", detail: "Perlu segera ditindaklanjuti", time: "5 menit lalu", icon: "clock", page: "loans" },
  { title: "6 buku stok menipis", detail: "Stok tersedia kurang dari 2", time: "1 jam lalu", icon: "book", page: "books" },
  { title: "Peminjaman baru tercatat", detail: "Nadia Putri meminjam Atomic Habits", time: "3 jam lalu", icon: "repeat", page: "loans" },
];

function NotificationPanel({ onNavigate, onClose, overdueCount, lowStockCount, readyReservations }: { onNavigate: (page: PageKey) => void; onClose: () => void; overdueCount: number; lowStockCount: number; readyReservations?: Reservation[] }) {
  const readyCount = readyReservations?.length ?? 0;
  const currentNotifications = notifications.map((notification, index) => index === 0 ? { ...notification, title: `${overdueCount} peminjaman terlambat`, detail: overdueCount > 0 ? "Perlu segera ditindaklanjuti" : "Tidak ada peminjaman terlambat" } : index === 1 ? { ...notification, title: `${lowStockCount} buku stok menipis`, detail: lowStockCount > 0 ? "Stok tersedia kurang dari 3" : "Semua stok buku aman" } : notification);
  return <div className="notification-panel" role="dialog" aria-label="Daftar notifikasi"><div className="notification-panel-header"><div><strong>Notifikasi</strong><small>{currentNotifications.length + (readyCount > 0 ? 1 : 0)} pemberitahuan terbaru</small></div><button type="button" onClick={onClose}>Tutup</button></div><div className="notification-list">{currentNotifications.map((notification) => <button type="button" className="notification-item" key={notification.title} onClick={() => { onNavigate(notification.page); onClose(); }}><span className="notification-icon"><Icon name={notification.icon} size={16} /></span><span className="notification-copy"><strong>{notification.title}</strong><small>{notification.detail}</small><em>{notification.time}</em></span><span className="notification-unread" /></button>)}{readyCount > 0 && readyReservations?.slice(0, 3).map((reservation) => <button type="button" className="notification-item" key={reservation.id} onClick={() => { onNavigate("reservations"); onClose(); }}><span className="notification-icon" style={{ background: "#e8f3ee", color: "var(--green)" }}><Icon name="check" size={16} /></span><span className="notification-copy"><strong>Buku tersedia: {reservation.book}</strong><small>{reservation.member} dapat mengambil buku ini</small><em>Sekarang</em></span><span className="notification-unread" /></button>)}</div><button type="button" className="notification-all" onClick={() => { onNavigate("loans"); onClose(); }}>Lihat semua aktivitas <span>→</span></button></div>;
}

const guideSteps: { title: string; description: string; tips: string[]; page: PageKey }[] = [
  { title: "Ringkasan", description: "Mulai dari sini untuk melihat kondisi perpustakaan hari ini.", tips: ["Pantau total koleksi, anggota aktif, dan jumlah buku yang sedang dipinjam.", "Gunakan bagian Perlu perhatian untuk melihat peminjaman terlambat dan stok menipis."], page: "overview" },
  { title: "Katalog E-Book", description: "Baca koleksi digital tanpa harus datang ke rak buku.", tips: ["Cari E-Book berdasarkan judul, penulis, atau kategori.", "Gunakan tombol Tambah E-Book untuk menambahkan koleksi digital baru ke katalog."], page: "ebooks" },
  { title: "Katalog Buku", description: "Kelola seluruh koleksi buku dengan lebih mudah.", tips: ["Cari buku berdasarkan judul, penulis, atau kategori.", "Gunakan tombol Tambah buku untuk menambahkan koleksi baru dan Peminjaman baru untuk mencatat transaksi."], page: "books" },
  { title: "Anggota", description: "Kelola Admin, Guru, dan Siswa serta dokumen keanggotaan mereka.", tips: ["Gunakan tab Admin, Guru, dan Siswa untuk melihat kelompok akun masing-masing.", "Unduh akun dalam CSV atau kartu anggota dalam format HTML yang dapat dicetak menjadi PDF."], page: "members" },
  { title: "Peminjaman", description: "Pantau semua transaksi peminjaman dan pengembalian.", tips: ["Gunakan tab untuk memfilter buku yang sedang dipinjam, terlambat, atau sudah dikembalikan.", "Klik Peminjaman baru untuk mencatat transaksi baru."], page: "loans" },
  { title: "Pengaturan", description: "Sesuaikan profil, kategori, dan preferensi notifikasi perpustakaan.", tips: ["Atur nama perpustakaan, email admin, durasi peminjaman, dan zona waktu.", "Tambahkan kategori baru untuk digunakan saat membuat buku atau E-Book."], page: "settings" },
];

function GuideModal({ onClose, onNavigate }: { onClose: () => void; onNavigate: (page: PageKey) => void }) {
  const [step, setStep] = useState(0);
  const currentStep = guideSteps[step];

  const openCurrentPage = () => {
    onNavigate(currentStep.page);
    onClose();
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">PANDUAN AL-HAYTHAM LIBRARY</span><h2 id="guide-title">Cara menggunakan aplikasi</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Tutup panduan"><Icon name="close" size={20} /></button></div><div className="guide-progress" aria-label="Progress panduan">{guideSteps.map((guideStep, index) => <button type="button" key={guideStep.title} className={index === step ? "active" : index < step ? "complete" : ""} onClick={() => setStep(index)} aria-label={`Langkah ${index + 1}: ${guideStep.title}`}><span /></button>)}</div><div className="guide-hero"><span className="guide-number">0{step + 1}</span><div><h3>{currentStep.title}</h3><p>{currentStep.description}</p></div></div><ul className="guide-tips">{currentStep.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul><div className="guide-footer"><span>Langkah {step + 1} dari {guideSteps.length}</span><div><button type="button" className="button button-outline" onClick={openCurrentPage}>Buka halaman</button>{step > 0 && <button type="button" className="button button-outline" onClick={() => setStep(step - 1)}>Kembali</button>}{step < guideSteps.length - 1 ? <button type="button" className="button button-primary" onClick={() => setStep(step + 1)}>Lanjut <span>→</span></button> : <button type="button" className="button button-primary" onClick={onClose}>Selesai</button>}</div></div></div></div>;
}

function QuickLoanModal({ membersList, booksList, onClose, onAddLoan }: { membersList: Member[]; booksList: Book[]; onClose: () => void; onAddLoan: (data: { memberCode: string; bookCode: string; borrowedDate: string; dueDate: string }) => boolean }) {
  const availableMembers = membersList.filter((member) => member.status === "Aktif");
  const availableBooks = booksList.filter((book) => book.available > 0);
  const [memberCode, setMemberCode] = useState(availableMembers[0]?.code ?? "");
  const [bookCode, setBookCode] = useState(availableBooks[0]?.code ?? "");
  const [borrowedDate, setBorrowedDate] = useState(dateInputValue());
  const [dueDate, setDueDate] = useState(dateAfterDays(7));
  const [error, setError] = useState("");

  const selectedBook = availableBooks.find((book) => book.code === bookCode);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!memberCode || !bookCode) {
      setError("Pilih anggota dan buku terlebih dahulu.");
      return;
    }
    if (dueDate <= borrowedDate) {
      setError("Jatuh tempo harus setelah tanggal pinjam.");
      return;
    }
    if (!onAddLoan({ memberCode, bookCode, borrowedDate, dueDate })) {
      setError("Buku sudah tidak tersedia. Silakan pilih buku lain.");
    }
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">TRANSAKSI BARU</span><h2 id="modal-title">Buat peminjaman</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Tutup"><Icon name="close" size={20} /></button></div><form onSubmit={submit}><div className="form-grid"><label className="form-span">Anggota<select value={memberCode} onChange={(event) => { setMemberCode(event.target.value); setError(""); }}><option value="">Pilih anggota aktif</option>{availableMembers.map((member) => <option key={member.code} value={member.code}>{member.name} · {member.code}</option>)}</select></label><label className="form-span">Buku<select value={bookCode} onChange={(event) => { setBookCode(event.target.value); setError(""); }}><option value="">Pilih buku tersedia</option>{availableBooks.map((book) => <option key={book.code} value={book.code}>{book.title} · {book.available} tersedia</option>)}</select></label><label>Tanggal pinjam<input type="date" value={borrowedDate} onChange={(event) => setBorrowedDate(event.target.value)} /></label><label>Jatuh tempo<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div>{selectedBook && <div className="loan-note"><Icon name="book" size={17} /><span>Stok <b>{selectedBook.title}</b> tersisa <b>{selectedBook.available}</b> buku.</span></div>}{error && <div className="form-error"><Icon name="alert" size={16} />{error}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Batal</button><button type="submit" className="button button-primary">Simpan peminjaman</button></div></form></div></div>;
}

export default function LibraryApp({ adminMemberCode }: { adminMemberCode?: string } = {}) {
  const router = useRouter();
  const [activePage, setActivePage] = useState<PageKey>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [ebookModalOpen, setEbookModalOpen] = useState(false);
  const [ebookToEdit, setEbookToEdit] = useState<EBook | null>(null);
  const [readingEbook, setReadingEbook] = useState<EBook | null>(null);
  const [readingMode, setReadingMode] = useState<ReadingMode>("flipbook");
  const [modeChooser, setModeChooser] = useState<EBook | null>(null);

  // Ganti mode lewat toolbar: sekalian jadi preferensi perangkat untuk klik Baca berikutnya.
  const changeReadingMode = useCallback((mode: ReadingMode) => {
    setReadingMode(mode);
    rememberReadingMode(mode);
  }, []);
  const [bookModalOpen, setBookModalOpen] = useState(false);
  const [bookToEdit, setBookToEdit] = useState<Book | null>(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [memberToEdit, setMemberToEdit] = useState<Member | null>(null);
  const [classModalOpen, setClassModalOpen] = useState(false);
  const [studentImportOpen, setStudentImportOpen] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [profile, setProfile] = useState<ProfileData>({ name: "Administrator", email: "", phone: "", bio: "", role: "staff", detail: "Administrator" });
  const [ebooksList, setEbooksList] = useState<EBook[]>(initialEbooks);
  const [booksList, setBooksList] = useState<Book[]>(initialBooks);
  const [membersList, setMembersList] = useState<Member[]>(initialMembers);
  const [loansList, setLoansList] = useState<Loan[]>(initialLoans);
  const [reservationsList, setReservationsList] = useState<Reservation[]>([]);
  const [classes, setClasses] = useState<string[]>(initialClasses);
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [catalogHydrated, setCatalogHydrated] = useState(false);
  type Toast = { id: number; message: string; type: "error" | "success" | "info" };
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = (message: string, type: Toast["type"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  };
  const removeToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));
  const [avatarShape, setAvatarShape] = useState<"round" | "square">("round");
  const [libraryName, setLibraryName] = useState("Al-Haytham Library");
  const [adminEmail, setAdminEmail] = useState("admin@alhaytham.sch.id");
  const [loanDuration, setLoanDuration] = useState("7");
  const [dueDateReminder, setDueDateReminder] = useState(true);
  const [lowStockReminder, setLowStockReminder] = useState(true);
  const [timezone, setTimezone] = useState("WIB (UTC+7)");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "auto";
    try {
      const stored = window.localStorage.getItem(DARK_MODE_STORAGE_KEY);
      if (stored === "light" || stored === "dark" || stored === "auto") return stored;
    } catch { /* ignore */ }
    return "auto";
  });

  useEffect(() => {
    let active = true;
    const hydrateCatalog = async () => {
      try {          const [remoteEbooks, remoteBooks, remoteMembers, remoteLoans, remoteReservations, remoteCategories, remoteClasses, remoteProfile, storedAvatarShape, storedLibraryName, storedAdminEmail, storedLoanDuration, storedDueDateReminder, storedLowStockReminder, storedTimezone] = await Promise.all([
          api.fetchEbooks().catch(() => [] as api.EBook[]),
          api.fetchBooks().catch(() => [] as api.Book[]),
          api.fetchMembers().catch(() => [] as api.Member[]),
          api.fetchLoans().catch(() => [] as api.Loan[]),
          api.fetchReservations().catch(() => [] as api.Reservation[]),
          api.fetchCategories().catch(() => [] as string[]),
          api.fetchClasses().catch(() => [] as string[]),
          api.fetchProfile().catch(() => null),
          api.fetchSetting("avatar-shape").catch(() => null),
          api.fetchSetting("library-name").catch(() => null),
          api.fetchSetting("admin-email").catch(() => null),
          api.fetchSetting("loan-duration").catch(() => null),
          api.fetchSetting("due-date-reminder").catch(() => null),
          api.fetchSetting("low-stock-reminder").catch(() => null),
          api.fetchSetting("timezone").catch(() => null),
        ]);
        if (active) {
          const clean = <T extends Record<string, unknown>>(rows: T[]): T[] =>
            rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? undefined : v])) as T);
          setEbooksList(remoteEbooks.length > 0 ? clean(remoteEbooks) : initialEbooks);
          setBooksList(remoteBooks.length > 0 ? clean(remoteBooks) : initialBooks);
          const cleanedMembers = remoteMembers.length > 0 ? clean(remoteMembers) : initialMembers;
          setMembersList(cleanedMembers);
          // Populate profile from logged-in admin member
          if (adminMemberCode) {
            const adminMember = cleanedMembers.find((m) => m.code === adminMemberCode);
            if (adminMember) {
              setProfile({
                name: adminMember.name || 'Administrator',
                email: adminMember.email || '',
                phone: adminMember.phone || '',
                bio: adminMember.bio || '',
                role: 'staff',
                detail: adminMember.className || adminMember.role || 'Admin',
                avatarData: adminMember.avatarData || '',
                avatarName: adminMember.avatarName || '',
              });
              if (adminMember.email) setAdminEmail(adminMember.email);
              if (adminMember.avatarShape === 'square' || adminMember.avatarShape === 'round') setAvatarShape(adminMember.avatarShape as 'round' | 'square');
              if (adminMember.themeMode === 'light' || adminMember.themeMode === 'dark' || adminMember.themeMode === 'auto') setThemeMode(adminMember.themeMode as 'light' | 'dark' | 'auto');
            }
          }
          setLoansList(remoteLoans.length > 0 ? clean(remoteLoans).map((l) => ({ ...l, status: l.status as LoanStatus })) : initialLoans);
          setReservationsList(remoteReservations.length > 0 ? clean(remoteReservations).map((r) => ({ ...r, status: r.status as ReservationStatus })) : []);
          setCategories(remoteCategories.length > 0 ? remoteCategories : initialCategories);
          setClasses(remoteClasses.length > 0 ? remoteClasses : initialClasses);
          if (remoteProfile) setProfile((current) => ({ ...current, ...clean([remoteProfile])[0] }));
          if (storedAvatarShape === "square" || storedAvatarShape === "round") setAvatarShape(storedAvatarShape);
          if (storedLibraryName) setLibraryName(storedLibraryName);
          if (storedAdminEmail) setAdminEmail(storedAdminEmail);
          if (storedLoanDuration) setLoanDuration(storedLoanDuration);
          if (storedDueDateReminder === "true" || storedDueDateReminder === "false") setDueDateReminder(storedDueDateReminder === "true");
          if (storedLowStockReminder === "true" || storedLowStockReminder === "false") setLowStockReminder(storedLowStockReminder === "true");
          if (storedTimezone) setTimezone(storedTimezone);
          void migrateLocalFilesToDrive(
            remoteBooks,
            remoteEbooks,
            remoteMembers,
            (nextMembers) => setMembersList(nextMembers),
            (message) => addToast(message, "error")
          ).catch((error) => {
            addToast(`Migrasi file ke Google Drive gagal: ${error instanceof Error ? error.message : "coba lagi"}.`, "error");
          });
          if (remoteProfile?.avatarData?.startsWith("data:")) {
            void (async () => {
              const avatarData = await moveAvatarToRemote("profile-avatar", remoteProfile.avatarData);
              await api.updateProfile({ ...remoteProfile, avatarData });
              setProfile((current) => ({ ...current, avatarData }));
            })().catch(() => undefined);
          }
          setCatalogHydrated(true);
        }
      } catch {
        // Remote API unreachable — fall back to initial/seeded data.
        if (active) {
          addToast("API tidak dapat diakses. Menggunakan data awal.", "error");
          setCatalogHydrated(true);
        }
      }
    };
    hydrateCatalog();
    return () => { active = false; };
  }, []);

  const [swUpdateReady, setSwUpdateReady] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | null = null;
    const registerServiceWorker = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js");
        // Check for updates every 60 minutes
        const checkUpdate = () => registration?.update().catch(() => undefined);
        checkUpdate();
        const interval = window.setInterval(checkUpdate, 60 * 60 * 1000);
        // Listen for new SW installing
        registration.addEventListener("updatefound", () => {
          const newWorker = registration?.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              setSwUpdateReady(true);
            }
          });
        });
        return () => window.clearInterval(interval);
      } catch { /* ignore */ }
    };
    window.addEventListener("load", registerServiceWorker);
    return () => window.removeEventListener("load", registerServiceWorker);
  }, []);
  const applySwUpdate = () => {
    navigator.serviceWorker.controller?.postMessage({ type: "SKIP_WAITING" });
    setSwUpdateReady(false);
    window.location.reload();
  };

  // Persist avatar shape to remote
  useEffect(() => {
    if (!catalogHydrated) return;
    void api.saveSetting("avatar-shape", avatarShape).catch(() => undefined);
  }, [avatarShape, catalogHydrated]);

  // Load persisted dark mode setting from remote after hydration
  useEffect(() => {
    if (!catalogHydrated) return;
    let active = true;
    void api.fetchSetting("dark-mode").then((stored) => {
      if (!active) return;
      if (stored === "light" || stored === "dark" || stored === "auto") setThemeMode(stored);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [catalogHydrated]);

  // Resolve effective dark mode
  const [prefersDark, setPrefersDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const isDark = themeMode === "dark" || (themeMode === "auto" && prefersDark);

  // Listen for OS preference changes when mode is "auto"
  useEffect(() => {
    if (themeMode !== "auto") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setPrefersDark(mql.matches);
    handler();
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [themeMode]);

  // Persist local storage for instant load on next visit
  useEffect(() => {
    try { window.localStorage.setItem(DARK_MODE_STORAGE_KEY, themeMode); } catch { /* ignore */ }
  }, [themeMode]);

  // Persist dark mode setting to remote
  useEffect(() => {
    if (!catalogHydrated) return;
    void api.saveSetting("dark-mode", themeMode).catch(() => undefined);
  }, [themeMode, catalogHydrated]);

  const addCategory = (name: string) => {
    const normalized = name.trim();
    if (!normalized || categories.some((category) => category.toLowerCase() === normalized.toLowerCase())) return false;
    setCategories((current) => [...current, normalized]);
    void api.createCategory(normalized).catch((err) => {
      console.error("Gagal menyimpan kategori:", err);
      addToast(`Kategori gagal tersimpan ke database: ${err instanceof Error ? err.message : "coba lagi"}.`, "error");
      setCategories((current) => current.filter((category) => category !== normalized));
    });
    return true;
  };

  const deleteCategory = (name: string) => {
    const used = [...booksList, ...ebooksList].some((item) => item.category.toLowerCase() === name.toLowerCase());
    if (used) return false;
    setCategories((current) => current.filter((category) => category !== name));
    void api.deleteCategory(name).catch((err) => {
      console.error("Gagal menghapus kategori:", err);
      addToast(`Kategori gagal dihapus dari database: ${err instanceof Error ? err.message : "coba lagi"}.`, "error");
      setCategories((current) => current.includes(name) ? current : [...current, name]);
    });
    return true;
  };

  const addEbook = async (ebook: EBook, file: File, onProgress?: (percent: number) => void) => {
    const isConflictError = (err: unknown) => err instanceof Error && err.message.includes("(409)");
    const codeNumber = (code: string) => Number(String(code).replace(/\D/g, "")) || 0;
    const codeFor = (num: number) => `EB-${String(num).padStart(5, "0")}`;
    const freshCodes = async (): Promise<string[]> => {
      try {
        return (await api.fetchEbooks()).map((item) => item.code);
      } catch {
        return ebooksList.map((item) => item.code);
      }
    };
    const nextFreeDraft = async (base: EBook): Promise<EBook> => {
      const existing = await freshCodes();
      const max = Math.max(codeNumber(base.code), ...existing.map(codeNumber), ...ebooksList.map((item) => codeNumber(item.code)));
      const next = codeFor(max + 1);
      return { ...base, code: next, fileId: `ebook:${next}` };
    };
    let draft = ebook;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await storeLibraryFile(draft.fileId!, file, true, false, onProgress);
      } catch (uploadErr) {
        if (!isConflictError(uploadErr) || attempt === 4) throw uploadErr;
        const existing = await freshCodes();
        if (existing.includes(draft.code)) {
          draft = await nextFreeDraft(draft);
          continue;
        }
        // File yatim di Drive tanpa metadata: reclaim dengan timpa aman.
        try {
          await storeLibraryFile(draft.fileId!, file, true, true, onProgress);
        } catch (reclaimErr) {
          if (!isConflictError(reclaimErr)) throw reclaimErr;
          draft = await nextFreeDraft(draft);
          continue;
        }
      }
      try {
        await api.createEbook(draft);
      } catch (createErr) {
        await api.deleteFile(draft.fileId!).catch(() => undefined);
        await deleteBrowserFile(draft.fileId!).catch(() => undefined);
        if (!isConflictError(createErr) || attempt === 4) throw createErr;
        draft = await nextFreeDraft(draft);
        continue;
      }
      setEbooksList((current) => (current.some((item) => item.code === draft.code) ? current : [...current, draft]));
      setEbookModalOpen(false);
      return;
    }
  };

  const updateEbook = async (nextEbook: EBook, file?: File, onProgress?: (percent: number) => void) => {
    if (file && nextEbook.fileId) await storeLibraryFile(nextEbook.fileId, file, true, true, onProgress);
    await api.updateEbook(nextEbook);
    setEbooksList((current) => current.map((ebook) => ebook.code === nextEbook.code ? nextEbook : ebook));
    setEbookToEdit(null);
  };

  const deleteEbook = async (ebook: EBook) => {
    try {
      // Keep metadata intact if the Drive file cannot be removed.
      if (ebook.fileId) await api.deleteFile(ebook.fileId);
      await api.deleteEbook(ebook.code);
    } catch (err) {
      console.error("Gagal menghapus E-Book:", err);
      addToast(`E-Book gagal dihapus: ${err instanceof Error ? err.message : "coba lagi"}.`, "error");
      return;
    }
    if (ebook.fileId) await deleteBrowserFile(ebook.fileId).catch(() => undefined);
    await clearReadingProgress(ebook.code);
    setEbooksList((current) => current.filter((item) => item.code !== ebook.code));
    setEbookToEdit((current) => current?.code === ebook.code ? null : current);
  };

  const addBook = async (book: Book, cover?: File) => {
    // Kode diambil ulang dari server: daftar di layar bisa tertinggal bila ada tab
    // atau petugas lain yang menambah buku, dan kode tabrakan membuat insert gagal.
    const freshBooks = await api.fetchBooks().catch(() => null);
    let candidate = book;
    if (freshBooks) {
      const freshCode = nextBookCodeFrom(freshBooks);
      if (freshCode !== book.code) {
        candidate = { ...book, code: freshCode, coverId: cover ? `book-cover:${freshCode}` : undefined };
      }
    }

    const uploadedIds: string[] = [];
    let saved: Book | null = null;
    let failure: unknown = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (cover && candidate.coverId) {
          await storeLibraryFile(candidate.coverId, cover);
          if (!uploadedIds.includes(candidate.coverId)) uploadedIds.push(candidate.coverId);
        }
        await api.createBook(candidate);
        saved = candidate;
        break;
      } catch (error) {
        failure = error;
        const conflict = error instanceof api.ApiError && error.status === 409;
        if (!conflict || attempt === 2) break;
        const latest = await api.fetchBooks().catch(() => null);
        if (!latest) break;
        const nextCode = nextBookCodeFrom(latest);
        if (nextCode === candidate.code) break;
        candidate = { ...candidate, code: nextCode, coverId: cover ? `book-cover:${nextCode}` : undefined };
      }
    }

    // Gagal tersimpan: buang file cover yang terlanjur diunggah, lalu teruskan
    // errornya supaya modal tetap terbuka dengan pesan yang jelas (bukan buku hantu).
    if (!saved) {
      for (const id of uploadedIds) {
        await api.deleteFile(id).catch(() => undefined);
        await deleteBrowserFile(id).catch(() => undefined);
      }
      throw failure instanceof Error ? failure : new Error("Buku tidak dapat disimpan ke server.");
    }

    const toSave = saved;
    // Buang file cover milik percobaan yang gagal sebelumnya.
    for (const id of uploadedIds) {
      if (id === toSave.coverId) continue;
      await api.deleteFile(id).catch(() => undefined);
      await deleteBrowserFile(id).catch(() => undefined);
    }
    setBooksList((current) => [...current, toSave]);
    setBookModalOpen(false);
  };

  const updateBook = async (nextBook: Book, cover?: File) => {
    if (cover && nextBook.coverId) await storeLibraryFile(nextBook.coverId, cover);
    await api.updateBook(nextBook);
    setBooksList((current) => current.map((book) => book.code === nextBook.code ? nextBook : book));
    setBookToEdit(null);
  };

  const deleteBook = async (book: Book) => {
    const hasActiveLoan = loansList.some((loan) => loan.bookCode === book.code && getLoanStatus(loan) !== "Dikembalikan");
    if (hasActiveLoan) {
      addToast(`Buku “${book.title}” masih memiliki peminjaman aktif. Kembalikan bukunya terlebih dahulu.`, "info");
      return;
    }
    if (book.coverId) {
      try {
        await deleteBrowserFile(book.coverId);
      } catch {
        // Lanjutkan menghapus metadata meskipun file cover sudah tidak ada.
      }
      await api.deleteFile(book.coverId).catch(() => undefined);
    }
    await api.deleteBook(book.code).catch(() => undefined);
    setBooksList((current) => current.filter((item) => item.code !== book.code));
    setBookToEdit((current) => current?.code === book.code ? null : current);
  };

  const addMember = (member: Member) => {
    setMembersList((current) => [...current, member]);
    void (async () => {
      const remoteMember = { ...member, avatarData: await moveAvatarToRemote(`member-avatar:${member.code}`, member.avatarData) };
      await api.createMember(remoteMember);
      setMembersList((current) => current.map((item) => item.code === member.code ? remoteMember : item));
    })().catch(() => undefined);
    setMemberModalOpen(false);
  };

  const importStudents = (rows: StudentImportRow[]): StudentImportSummary => {
    const workingMembers = [...membersList];
    const addedMembers: Member[] = [];
    const errors: string[] = [];
    const colors = ["#cfe4da", "#dce9f5", "#f5d9c8", "#e6dff2", "#e3eadc", "#dfeef3"];
    rows.forEach((row) => {
      const name = row.name.trim();
      const matchedClass = classes.find((item) => item.toLowerCase() === row.className.trim().toLowerCase());
      if (!name) {
        errors.push(`Baris ${row.rowNumber}: Nama Siswa wajib diisi.`);
        return;
      }
      if (!matchedClass) {
        errors.push(`Baris ${row.rowNumber}: Kelas “${row.className || "(kosong)"}” tidak tersedia. Gunakan kelas pada menu Anggota.`);
        return;
      }
      const username = (row.username.trim() || createMemberUsername(name)).toLowerCase();
      if (!username) {
        errors.push(`Baris ${row.rowNumber}: Username tidak dapat dibuat dari nama.`);
        return;
      }
      if (workingMembers.some((member) => member.username.toLowerCase() === username)) {
        errors.push(`Baris ${row.rowNumber}: Username “${username}” sudah digunakan.`);
        return;
      }
      const member: Member = { name, code: memberCodeForRole("Siswa", workingMembers), className: matchedClass, joined: formatMemberJoinDate(), status: "Aktif", initials: getInitials(name), color: colors[(membersList.length + addedMembers.length) % colors.length], role: "Siswa", username, password: row.password.trim() || `AlHaytham${new Date().getFullYear()}!` };
      workingMembers.push(member);
      addedMembers.push(member);
    });
    if (addedMembers.length > 0) {
      setMembersList((current) => [...current, ...addedMembers]);
      void (async () => {
        for (const member of addedMembers) {
          const remoteMember = { ...member, avatarData: await moveAvatarToRemote(`member-avatar:${member.code}`, member.avatarData) };
          await api.createMember(remoteMember);
          setMembersList((current) => current.map((item) => item.code === member.code ? remoteMember : item));
        }
      })().catch(() => undefined);
    }
    return { added: addedMembers.length, errors };
  };

  const updateMember = (nextMember: Member) => {
    const previousMember = membersList.find((member) => member.code === nextMember.code);
    setMembersList((current) => current.map((member) => member.code === nextMember.code ? nextMember : member));
    setLoansList((current) => current.map((loan) => loan.memberCode === nextMember.code ? { ...loan, member: nextMember.name, avatar: nextMember.initials, color: nextMember.color, avatarData: nextMember.avatarData } : loan));
    void (async () => {
      if (!nextMember.avatarData && previousMember?.avatarData) await api.deleteFile(`member-avatar:${nextMember.code}`).catch(() => undefined);
      const remoteMember = { ...nextMember, avatarData: await moveAvatarToRemote(`member-avatar:${nextMember.code}`, nextMember.avatarData) };
      await api.updateMember(remoteMember);
      setMembersList((current) => current.map((member) => member.code === nextMember.code ? remoteMember : member));
      setLoansList((current) => current.map((loan) => loan.memberCode === nextMember.code ? { ...loan, avatarData: remoteMember.avatarData } : loan));
    })().catch(() => undefined);
    setMemberToEdit(null);
  };

  const addClass = (name: string) => {
    const normalized = name.trim();
    if (!normalized || classes.some((item) => item.toLowerCase() === normalized.toLowerCase())) return false;
    setClasses((current) => [...current, normalized]);
    void api.createClass(normalized).catch((err) => {
      console.error("Gagal menyimpan kelas:", err);
      addToast(`Kelas gagal tersimpan ke database: ${err instanceof Error ? err.message : "coba lagi"}.`, "error");
      setClasses((current) => current.filter((item) => item !== normalized));
    });
    return true;
  };

  const deleteClass = (name: string) => {
    if (membersList.some((member) => member.role === "Siswa" && member.className.toLowerCase() === name.toLowerCase())) return false;
    setClasses((current) => current.filter((item) => item !== name));
    void api.deleteClass(name).catch((err) => {
      console.error("Gagal menghapus kelas:", err);
      addToast(`Kelas gagal dihapus dari database: ${err instanceof Error ? err.message : "coba lagi"}.`, "error");
      setClasses((current) => current.includes(name) ? current : [...current, name]);
    });
    return true;
  };

  const deleteMember = async (member: Member) => {
    const hasActiveLoan = loansList.some((loan) => loan.memberCode === member.code && getLoanStatus(loan) !== "Dikembalikan");
    if (hasActiveLoan) {
      addToast(`Anggota “${member.name}” masih memiliki peminjaman aktif. Kembalikan bukunya terlebih dahulu.`, "info");
      return;
    }
    await api.deleteMember(member.code).catch(() => undefined);
    await api.deleteFile(`member-avatar:${member.code}`).catch(() => undefined);
    setMembersList((current) => current.filter((item) => item.code !== member.code));
    setMemberToEdit((current) => current?.code === member.code ? null : current);
  };

  const addLoan = (data: { memberCode: string; bookCode: string; borrowedDate: string; dueDate: string }) => {
    const member = membersList.find((item) => item.code === data.memberCode && item.status === "Aktif");
    const book = booksList.find((item) => item.code === data.bookCode);
    if (!member || !book || book.available <= 0) return false;
    const loan: Loan = { id: `loan-${Date.now()}`, member: member.name, memberCode: member.code, book: book.title, bookCode: book.code, borrowed: formatLoanDate(data.borrowedDate), borrowedDate: data.borrowedDate, due: formatLoanDate(data.dueDate), dueDate: data.dueDate, status: "Dipinjam", avatar: member.initials, color: member.color, avatarData: member.avatarData };
    setBooksList((current) => current.map((item) => item.code === book.code ? { ...item, available: item.available - 1 } : item));
    setLoansList((current) => [...current, loan]);
    void api.createLoan(loan).catch(() => undefined);
    void api.updateBook({ code: book.code, available: book.available - 1 }).catch(() => undefined);
    setModalOpen(false);
    return true;
  };

  const returnLoan = (loan: Loan) => {
    if (getLoanStatus(loan) === "Dikembalikan") return;
    setLoansList((current) => current.map((item) => item.id === loan.id ? { ...item, status: "Dikembalikan", returnedDate: dateInputValue() } : item));
    setBooksList((current) => current.map((item) => item.code === loan.bookCode ? { ...item, available: Math.min(item.stock, item.available + 1) } : item));
    void api.returnLoan(loan.id).catch(() => undefined);

    // Check for reservations and notify the first one
    void (async () => {
      try {
        const reservations = await api.fetchReservations();
        const bookReservations = reservations
          .filter((r) => r.bookCode === loan.bookCode && r.status === "Menunggu")
          .sort((a, b) => a.reservedAt.localeCompare(b.reservedAt));
        if (bookReservations.length > 0) {
          const firstReservation = bookReservations[0];
          await api.updateReservation(firstReservation.id, { status: "Tersedia" });
          await api.notifyReservation(firstReservation.id);
          setReservationsList((current) => current.map((r) =>
            r.id === firstReservation.id ? { ...r, status: "Tersedia" as ReservationStatus } : r
          ));
        }
      } catch {
        // Reservation notification failed silently
      }
    })();
  };

  const addReservation = (data: { memberCode: string; bookCode: string }) => {
    const member = membersList.find((item) => item.code === data.memberCode && item.status === "Aktif");
    const book = booksList.find((item) => item.code === data.bookCode);
    if (!member || !book) return false;

    // Check for existing active reservation
    const existing = reservationsList.find(
      (r) => r.memberCode === data.memberCode && r.bookCode === data.bookCode && r.status === "Menunggu"
    );
    if (existing) return false;

    const reservation: Reservation = {
      id: `res-${Date.now()}`,
      member: member.name,
      memberCode: member.code,
      book: book.title,
      bookCode: book.code,
      reservedAt: dateInputValue(),
      status: "Menunggu",
      avatar: member.initials,
      color: member.color,
      avatarData: member.avatarData,
    };

    setReservationsList((current) => [...current, reservation]);
    void api.createReservation(reservation).catch(() => undefined);
    return true;
  };

  const cancelReservation = (reservation: Reservation) => {
    setReservationsList((current) => current.filter((r) => r.id !== reservation.id));
    void api.deleteReservation(reservation.id).catch(() => undefined);
  };

  const fulfillReservation = (reservation: Reservation) => {
    setReservationsList((current) => current.map((r) =>
      r.id === reservation.id ? { ...r, status: "Selesai" as ReservationStatus } : r
    ));
    void api.updateReservation(reservation.id, { status: "Selesai" }).catch(() => undefined);
  };

  const saveProfile = (nextProfile: ProfileData) => {
    const previousProfile = profile;
    const hadAvatar = Boolean(profile.avatarData);
    setProfile(nextProfile);
    setProfileOpen(false);
    void (async () => {
      if (!nextProfile.avatarData && hadAvatar) await api.deleteFile("profile-avatar").catch(() => undefined);
      const remoteProfile = { ...nextProfile, avatarData: await moveAvatarToRemote("profile-avatar", nextProfile.avatarData) };
      await api.updateProfile(remoteProfile);
      setProfile((current) => ({ ...current, avatarData: remoteProfile.avatarData }));
      addToast("Profil berhasil disimpan.", "success");
    })().catch(() => {
      setProfile(previousProfile);
      addToast("Gagal menyimpan profil. Silakan coba lagi.", "error");
    });
  };

  const saveSettings = (data: { libraryName: string; adminEmail: string; loanDuration: string; dueDateReminder: boolean; lowStockReminder: boolean; timezone: string }) => {
    setLibraryName(data.libraryName);
    setAdminEmail(data.adminEmail);
    setLoanDuration(data.loanDuration);
    setDueDateReminder(data.dueDateReminder);
    setLowStockReminder(data.lowStockReminder);
    setTimezone(data.timezone);
    void api.saveSetting("library-name", data.libraryName).catch(() => undefined);
    void api.saveSetting("admin-email", data.adminEmail).catch(() => undefined);
    void api.saveSetting("loan-duration", data.loanDuration).catch(() => undefined);
    void api.saveSetting("due-date-reminder", String(data.dueDateReminder)).catch(() => undefined);
    void api.saveSetting("low-stock-reminder", String(data.lowStockReminder)).catch(() => undefined);
    void api.saveSetting("timezone", data.timezone).catch(() => undefined);
  };

  const navigate = (page: PageKey) => { setActivePage(page); setSidebarOpen(false); setNotificationsOpen(false); };
  const requestConfirmation = (request: ConfirmRequest) => setConfirmRequest(request);
  const nextEbookCode = `EB-${String(ebooksList.reduce((max, ebook) => Math.max(max, Number(ebook.code.replace(/\D/g, "")) || 0), 0) + 1).padStart(5, "0")}`;
  const nextBookCode = nextBookCodeFrom(booksList);
  const nextMemberCodes: Record<MemberRole, string> = { Admin: memberCodeForRole("Admin", membersList), Guru: memberCodeForRole("Guru", membersList), Siswa: memberCodeForRole("Siswa", membersList) };
  const activeLoanCount = loansList.filter((loan) => getLoanStatus(loan) !== "Dikembalikan").length;
  const overdueLoanCount = loansList.filter((loan) => getLoanStatus(loan) === "Terlambat").length;
  const lowStockCount = booksList.filter((book) => book.available <= 2).length;
  const pageTitle = activePage === "settings" ? "Pengaturan" : navItems.find((item) => item.key === activePage)?.label ?? "Ringkasan";

  return <div className={`app-shell avatar-shape-${avatarShape} ${isDark ? "dark-mode" : ""}`}>
    <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}><div className="brand"><img src="/logo.png" alt="Al-Haytham Library" className="brand-logo" width="36" height="36" /><span>Al-Haytham <span className="brand-accent">Library</span></span></div><div className="sidebar-label">MENU UTAMA</div><nav>{navItems.map((item) => <button key={item.key} className={`nav-item ${activePage === item.key ? "active" : ""}`} onClick={() => navigate(item.key)}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.key === "loans" && <em>{activeLoanCount}</em>}</button>)}</nav><div className="sidebar-label sidebar-secondary">LAINNYA</div><nav><button className={`nav-item ${activePage === "settings" ? "active" : ""}`} onClick={() => navigate("settings")}><Icon name="sliders" size={19} /><span>Pengaturan</span></button></nav><div className="sidebar-bottom"><div className="help-card"><div className="help-spark">✦</div><strong>Butuh bantuan?</strong><span>Pelajari cara menggunakan Al-Haytham Library.</span><button type="button" onClick={() => setGuideOpen(true)}>Mulai panduan <span>→</span></button></div>        <button className="user-card" onClick={() => setProfileOpen(true)} aria-label="Edit profil"><span className="avatar user-avatar">{profile.avatarData ? <img key={profile.avatarData} src={profile.avatarData} alt={`Foto ${profile.name}`} /> : getInitials(profile.name)}</span><span><b>{profile.name}</b><small>{profile.role === "student" ? "Siswa" : profile.detail}</small></span><Icon name="more" size={18} /></button></div></aside>
    <main className="main-content">{swUpdateReady && <div className="form-success storage-warning" style={{cursor:'pointer',display:'flex',alignItems:'center',gap:8,justifyContent:'space-between'}} onClick={applySwUpdate}><span>🔄 Versi baru tersedia. Klik untuk memperbarui.</span><button className="button button-primary" style={{flexShrink:0,padding:'6px 14px',fontSize:12}} onClick={applySwUpdate}>Muat Ulang</button></div>}<header className="topbar"><button className="mobile-menu icon-button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Buka menu"><Icon name="menu" size={21} /></button><div className="breadcrumb"><span>Perpustakaan</span><b>/</b><strong>{pageTitle}</strong></div><div className="topbar-actions"><label className="top-search"><Icon name="search" size={17} /><input placeholder="Cari apa saja..." /></label><div className="notification-wrap"><button className="notification-button" aria-label="Notifikasi" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(!notificationsOpen)}><Icon name="bell" size={20} /><span /></button>{notificationsOpen && <NotificationPanel onNavigate={navigate} onClose={() => setNotificationsOpen(false)} overdueCount={overdueLoanCount} lowStockCount={lowStockCount} readyReservations={reservationsList.filter((r) => r.status === "Tersedia")} />}</div><button className="top-avatar" onClick={() => setProfileOpen(true)} aria-label="Edit profil">{profile.avatarData ? <img key={profile.avatarData} src={profile.avatarData} alt={`Foto ${profile.name}`} /> : getInitials(profile.name)}</button></div></header><div key={activePage} className="page-content">{activePage === "overview" && <Overview booksList={booksList} ebooksList={ebooksList} membersList={membersList} loansList={loansList} onNavigate={navigate} onQuickLoan={() => setModalOpen(true)} adminName={profile.name} />}{activePage === "ebooks" && <EBooksPage ebooks={ebooksList} categories={categories} onAdd={() => setEbookModalOpen(true)} isAdmin={profile.role === "staff"} onRead={(ebook) => {
  if (ebook.format !== "PDF") { setReadingEbook(ebook); return; }
  const saved = getSavedReadingMode();
  // Sudah pernah memilih → langsung buka; belum pernah → tawarkan pemilih mode.
  if (saved) { setReadingMode(saved); setReadingEbook(ebook); return; }
  setModeChooser(ebook);
}} onEdit={(ebook) => setEbookToEdit(ebook)} onDelete={(ebook) => requestConfirmation({ title: "Hapus E-Book", message: `Hapus E-Book “${ebook.title}”? File yang tersimpan juga akan dihapus.`, confirmLabel: "Hapus E-Book", danger: true, onConfirm: () => deleteEbook(ebook) })} />}{activePage === "books" && <BooksPage booksList={booksList} categories={categories} onAdd={() => setBookModalOpen(true)} isAdmin={profile.role === "staff"} onEdit={(book) => setBookToEdit(book)} onDelete={(book) => requestConfirmation({ title: "Hapus buku", message: `Hapus buku “${book.title}”? Cover yang tersimpan juga akan dihapus.`, confirmLabel: "Hapus buku", danger: true, onConfirm: () => deleteBook(book) })} onReserve={(bookCode) => addReservation({ memberCode: profile.role === "staff" ? membersList[0]?.code : profile.detail, bookCode })} reservationsList={reservationsList} />}{activePage === "members" && <MembersPage membersList={membersList} classes={classes} onAdd={() => setMemberModalOpen(true)} onEdit={setMemberToEdit} onDelete={(member) => requestConfirmation({ title: "Hapus anggota", message: `Hapus anggota “${member.name}”? Riwayat transaksi yang sudah selesai tetap dipertahankan.`, confirmLabel: "Hapus anggota", danger: true, onConfirm: () => deleteMember(member) })} onAddClass={() => setClassModalOpen(true)} onImportStudents={() => setStudentImportOpen(true)} onDownloadTemplate={() => downloadStudentTemplate(classes)} onResetPassword={(member, newPassword) => updateMember({ ...member, password: newPassword })} />}{activePage === "loans" && <LoansPage loansList={loansList} membersList={membersList} onQuickLoan={() => setModalOpen(true)} onReturnLoan={returnLoan} />}{activePage === "reports" && <ReportsPage booksList={booksList} membersList={membersList} loansList={loansList} />}{activePage === "reservations" && <ReservationsPage reservationsList={reservationsList} booksList={booksList} membersList={membersList} onCancel={cancelReservation} onFulfill={fulfillReservation} />}{activePage === "settings" && <SettingsPage categories={categories} avatarShape={avatarShape} onAvatarShapeChange={setAvatarShape} themeMode={themeMode} onThemeModeChange={setThemeMode} onAddCategory={addCategory} onDeleteCategory={deleteCategory} libraryName={libraryName} adminEmail={adminEmail} loanDuration={loanDuration} dueDateReminder={dueDateReminder} lowStockReminder={lowStockReminder} timezone={timezone} onSaveSettings={saveSettings} />}</div></main>{modalOpen && <QuickLoanModal membersList={membersList} booksList={booksList} onClose={() => setModalOpen(false)} onAddLoan={addLoan} />}{ebookModalOpen && <AddEbookModal nextCode={nextEbookCode} categories={categories} onClose={() => setEbookModalOpen(false)} onAdd={addEbook} />}{ebookToEdit && <EditEbookModal ebook={ebookToEdit} categories={categories} onClose={() => setEbookToEdit(null)} onSave={updateEbook} />}{modeChooser && <ReadingModeDialog ebook={modeChooser} onClose={() => setModeChooser(null)} onPick={(mode) => { changeReadingMode(mode); setReadingEbook(modeChooser); setModeChooser(null); }} />}{readingEbook && <EbookReader ebook={readingEbook} mode={readingMode} onModeChange={changeReadingMode} onClose={() => setReadingEbook(null)} />}{bookModalOpen && <AddBookModal nextCode={nextBookCode} categories={categories} onClose={() => setBookModalOpen(false)} onAdd={addBook} />}{bookToEdit && <EditBookModal book={bookToEdit} categories={categories} onClose={() => setBookToEdit(null)} onSave={updateBook} />}{memberModalOpen && <AddMemberModal nextCodes={nextMemberCodes} existingMembers={membersList} classes={classes} onClose={() => setMemberModalOpen(false)} onAdd={addMember} />}{memberToEdit && <EditMemberModal member={memberToEdit} existingMembers={membersList} classes={classes} onClose={() => setMemberToEdit(null)} onSave={updateMember} />}{classModalOpen && <AddClassModal classes={classes} onClose={() => setClassModalOpen(false)} onAdd={addClass} onDelete={deleteClass} onConfirm={requestConfirmation} />}{studentImportOpen && <ImportStudentsModal classes={classes} onClose={() => setStudentImportOpen(false)} onImport={importStudents} />}{guideOpen && <GuideModal onClose={() => setGuideOpen(false)} onNavigate={navigate} />}{profileOpen && <ProfileModal profile={profile} onClose={() => setProfileOpen(false)} onSave={saveProfile} onLogout={() => requestConfirmation({ title: "Keluar dari aplikasi", message: "Apakah Anda yakin ingin keluar?", confirmLabel: "Keluar", danger: true, onConfirm: () => { void api.logout().catch(() => undefined); localStorage.clear(); router.push("/login"); } })} />}{confirmRequest && <ConfirmDialog request={confirmRequest} onClose={() => setConfirmRequest(null)} />}<div className="toast-container" aria-live="polite" aria-label="Notifikasi">{toasts.map((t) => <div key={t.id} className={`toast toast-${t.type}`} onClick={() => removeToast(t.id)}><span className="toast-icon">{t.type === "error" ? "❌" : t.type === "success" ? "✅" : "ℹ️"}</span><span className="toast-message">{t.message}</span><button className="toast-close" onClick={() => removeToast(t.id)} aria-label="Tutup">×</button></div>)}</div></div>;
}
