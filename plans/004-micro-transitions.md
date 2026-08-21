# 004 — Transisi mikro pada tab, guide progress, item notifikasi, dan pagination

- **Status**: TODO
- **Commit**: N/A — folder project ini bukan repo git
- **Severity**: LOW
- **Category**: Polish
- **Estimated scope**: 1 file (`app/globals.css`), 4 aturan CSS kecil

## Problem

Beberapa elemen interaktif mengganti warna/border secara instan tanpa transisi, terasa "patah" dibanding elemen lain yang sudah halus (`.nav-item`, `.button`, `.book-card`):

1. `.member-tab` (`app/globals.css:54`) — border-bottom aktif dan warna berubah instan saat pindah tab Siswa/Admin/Guru.
2. `.guide-progress button` (`app/globals.css:57`) — progress bar panduan berubah warna instan saat ganti langkah.
3. `.notification-item:hover` (`app/globals.css:46`) — background hover berubah instan.
4. `.page-number:hover, .page-number.active` (`app/globals.css:54`) — nomor pagination berubah instan.

Kode saat ini (ringkas):

```css
.member-tab { display: inline-flex; align-items: center; gap: 7px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #8b9992; padding: 9px 12px 11px; font-size: 11px; }
.member-tab.active { border-color: var(--green); color: var(--green-dark); font-weight: 700; }

.guide-progress button { border: 0; background: #e4ece8; border-radius: 99px; height: 5px; padding: 0; flex: 1; }
.guide-progress button.active, .guide-progress button.complete { background: var(--green); }

.notification-item { ... background: #fff; ... }
.notification-item:hover { background: #f8fbf9; }

.page-number { width: 26px; height: 26px; border-radius: 5px; border: 0; color: #8e9a94; background: transparent; font-size: 10px; }
.page-number:hover, .page-number.active { background: var(--green-soft); color: var(--green-dark); font-weight: 700; }
```

## Target

Tambah `transition` singkat dengan token `--ease-out` pada keempat elemen. Durasi 150ms — cepat, tidak memperlambat interaksi yang diulang (tab/pagination dipakai puluhan kali sehari, jadi harus ringan; hanya warna/border yang berubah, bukan gerakan):

```css
.member-tab { ...; transition: border-color .15s var(--ease-out), color .15s var(--ease-out); }

.guide-progress button { ...; transition: background .15s var(--ease-out); }

.notification-item { ...; transition: background-color .15s var(--ease-out); }

.page-number { ...; transition: background-color .15s var(--ease-out), color .15s var(--ease-out); }
```

Jangan ubah nilai lain (warna, padding, ukuran) — hanya tambah `transition`.

## Repo conventions to follow

- Token easing: `var(--ease-out)` (`app/globals.css:20`).
- Durasi konsisten aplikasi: 0.14–0.2s untuk hover/warna. `.nav-item` (`app/globals.css:41`) adalah exemplar: `transition: background-color .16s var(--ease-out), color .16s var(--ease-out), ...`.

## Steps

1. Buka `app/globals.css`.
2. `.member-tab` (baris ~54): tambah `transition: border-color .15s var(--ease-out), color .15s var(--ease-out);` di dalam aturannya.
3. `.guide-progress button` (baris ~57): tambah `transition: background .15s var(--ease-out);`.
4. `.notification-item` (baris ~46): tambah `transition: background-color .15s var(--ease-out);`.
5. `.page-number` (baris ~54): tambah `transition: background-color .15s var(--ease-out), color .15s var(--ease-out);`.
6. JANGAN ubah pseudo-class atau aturan `:hover`/`.active` — hanya aturan dasar elemen.

## Boundaries

- Do NOT touch `components/LibraryApp.tsx`.
- Do NOT ubah warna/nilai layout apa pun — hanya tambah properti `transition`.
- Do NOT add new dependencies.
- Jika baris tidak cocok dengan kode yang ditemukan, STOP dan laporkan.

## Verification

- **Mechanical**: `npm run typecheck` dan `npm run build` lolos.
- **Feel check**:
  - Tab anggota (Semua/Admin/Guru/Siswa): pindah tab — border-bottom hijau memudar masuk, tidak muncul seketika.
  - Panduan (Mulai panduan →): klik langkah berikutnya — progress bar menyala halus.
  - Hover baris notifikasi: background memudar.
  - Pagination: hover/aktif nomor halaman memudar.
  - Toggle `prefers-reduced-motion`: transisi warna tetap ada (warna/opacity dipertahankan, ini yang benar — reduced-motion tidak berarti nol feedback).
- **Done when**: keempat elemen punya transisi warna/border 150ms dengan `--ease-out` dan tidak ada perubahan lain.
