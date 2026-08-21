# 001 — Ganti animasi drawer sidebar mobile dari `left` ke `transform`

- **Status**: TODO
- **Commit**: N/A — folder project ini bukan repo git
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 1 file (`app/globals.css`), ~2 baris CSS

## Problem

Drawer sidebar di mobile menganimasikan `left` (layout property), bukan `transform`. Menganimasikan `left` memicu layout + paint + composite setiap frame, membuat slide terasa berat dan bisa drop frame di perangkat low-end. Durasi juga memakai `ease` bawaan, bukan token easing aplikasi.

Kode saat ini (`app/globals.css:65`, di dalam `@media (max-width: 760px)`):

```css
.sidebar { position: fixed; left: -250px; top: 0; bottom: 0; transition: left .2s; box-shadow: 12px 0 30px rgba(25,50,39,.08); }
.sidebar.sidebar-open { left: 0; }
```

Catatan: aturan `.sidebar { position: fixed; left: -250px; ... }` TIDAK hanya muncul di mobile — aturan yang sama juga ada di luar media query (lihat `app/globals.css:57`, baris `.sidebar` base). Hati-hati: jangan mengubah `.sidebar` base (desktop), hanya yang berada di dalam blok `@media (max-width: 760px)`.

## Target

Pindahkan off-screen state ke `transform: translateX(-100%)` dan animasikan `transform` dengan token `--ease-out`. Drawer selebar 218px di mobile (lihat media query `max-width:1120px` → `.sidebar { width: 218px; }`), jadi `translateX(-100%)` menyembunyikan penuh tanpa hardcode piksel (sesuai aturan "prefer percentages over hardcoded pixel values").

```css
/* di dalam @media (max-width: 760px) */
.sidebar { position: fixed; top: 0; bottom: 0; left: 0; transform: translateX(-100%); transition: transform .24s var(--ease-out); box-shadow: 12px 0 30px rgba(25,50,39,.08); }
.sidebar.sidebar-open { transform: translateX(0); }
```

Perubahan: `left: -250px` → `left: 0` + `transform: translateX(-100%)`; `transition: left .2s` → `transition: transform .24s var(--ease-out)`; `.sidebar-open { left: 0 }` → `.sidebar-open { transform: translateX(0) }`.

## Repo conventions to follow

- Token easing sudah didefinisikan di `app/globals.css:20` (`:root`): `--ease-out: cubic-bezier(0.23, 1, 0.32, 1);` — gunakan `var(--ease-out)`, jangan `ease` bawaan.
- Contoh yang sudah benar: `.book-card` (`app/globals.css:54`) memakai `transition: transform .2s var(--ease-out), box-shadow .2s var(--ease-out);`.
- Durasi UI aplikasi ini konsisten di 0.14–0.35s; drawer (sejenis drawer/modal) boleh 200–500ms — 0.24s pilihan yang pas.

## Steps

1. Buka `app/globals.css`, temukan blok `@media (max-width: 760px)` (baris ~65).
2. Di dalam blok itu, ganti aturan `.sidebar { position: fixed; left: -250px; top: 0; bottom: 0; transition: left .2s; ... }` menjadi `.sidebar { position: fixed; left: 0; top: 0; bottom: 0; transform: translateX(-100%); transition: transform .24s var(--ease-out); ... }` (pertahankan `box-shadow` dan properti lain apa adanya).
3. Ganti `.sidebar.sidebar-open { left: 0; }` menjadi `.sidebar.sidebar-open { transform: translateX(0); }`.
4. JANGAN sentuh `.sidebar` di luar media query (desktop) dan jangan sentuh `.sidebar-label`, `.sidebar-bottom`, atau komponen lain.

## Boundaries

- Do NOT touch `.sidebar` base di luar `@media (max-width: 760px)` — itu layout desktop statis, tidak perlu transform.
- Do NOT touch `components/LibraryApp.tsx` — markup tidak berubah.
- Do NOT add new dependencies.
- Jika baris tidak cocok dengan kode yang ditemukan (drift), STOP dan laporkan alih-alih menebak.

## Verification

- **Mechanical**: `npm run typecheck` dan `npm run build` — keduanya harus lolos (perubahan hanya CSS).
- **Feel check**: buka preview di viewport mobile (< 760px, mis. DevTools responsive mode 375px), klik tombol menu (hamburger):
  - Sidebar meluncur masuk dari kiri dengan kurva ease-out — mulai cepat, melambat di akhir.
  - Buka tab Animations di DevTools: animasi memakai `transform` (translateX), bukan `left` — tidak ada pemindahan layout.
  - Tutup drawer: slide keluar ke kiri, juga `transform`.
  - Toggle `prefers-reduced-motion` (Rendering panel): drawer tetap muncul/menghilang (state change harus tetap terlihat), hanya tanpa slide.
- **Done when**: tidak ada `left` yang dianimasikan di drawer mobile; drawer meluncur halus dengan `--ease-out`.
