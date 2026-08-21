# 003 — Konsistensi easing token pada modal backdrop + hapus keyframes mati

- **Status**: TODO
- **Commit**: N/A — folder project ini bukan repo git
- **Severity**: LOW
- **Category**: Cohesion & tokens
- **Estimated scope**: 1 file (`app/globals.css`), 2 suntingan kecil

## Problem

Dua masalah kecil di `app/globals.css`:

1. `.modal-backdrop` (baris ~56) memakai easing bawaan `ease-out` untuk animasinya, sementara `.modal` tepat di sebelahnya memakai token `var(--ease-out)`. Inkonsistensi ini membuat seluruh aplikasi (yang sudah konsisten pakai token) punya satu pengecualian yang terasa beda tipis.

2. `@keyframes rise` (baris ~57) tidak pernah dipakai — grep `rise` hanya menemukan definisinya sendiri, tidak ada `animation: rise` di mana pun. Kode mati.

Kode saat ini (`app/globals.css:56-57`):

```css
.modal-backdrop { position: fixed; z-index: 100; inset: 0; background: rgba(22, 37, 31, .32); display: grid; place-items: center; padding: 20px; animation: fadein .2s ease-out; }
...
@keyframes fadein { from { opacity: 0; } to { opacity: 1; } }@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }@keyframes modal-in { from { opacity: 0; transform: translateY(10px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }@keyframes popover-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }@keyframes card-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
```

## Target

```css
.modal-backdrop { position: fixed; z-index: 100; inset: 0; background: rgba(22, 37, 31, .32); display: grid; place-items: center; padding: 20px; animation: fadein .2s var(--ease-out); }
```

Dan hapus `@keyframes rise { ... }` dari blok keyframes, sisakan:

```css
@keyframes fadein { from { opacity: 0; } to { opacity: 1; } }@keyframes modal-in { from { opacity: 0; transform: translateY(10px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }@keyframes popover-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }@keyframes card-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
```

## Repo conventions to follow

- Semua easing aplikasi memakai token `var(--ease-out)` dari `:root` (`app/globals.css:20`). `.modal` (`app/globals.css:56`) adalah exemplar: `animation: modal-in .24s var(--ease-out);`.
- Keyframes lain (`fadein`, `modal-in`, `popover-in`, `card-in`) semuanya masih dipakai — jangan dihapus selain `rise`.

## Steps

1. Buka `app/globals.css`.
2. Pada aturan `.modal-backdrop` (baris ~56), ganti `animation: fadein .2s ease-out` → `animation: fadein .2s var(--ease-out)`.
3. Pada blok keyframes (baris ~57), hapus teks `@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }` (termasuk spasi antar keyframes yang tersisa, rapikan satu baris).
4. Verifikasi tidak ada lagi referensi `rise` di file: `grep -n "rise" app/globals.css` harus kosong.

## Boundaries

- Do NOT touch `.modal` (sudah benar), `modal-in`, `fadein`, `popover-in`, atau `card-in`.
- Do NOT touch `components/LibraryApp.tsx`.
- Do NOT add new dependencies.
- Jika baris tidak cocok dengan kode yang ditemukan, STOP dan laporkan.

## Verification

- **Mechanical**: `npm run typecheck` dan `npm run build` lolos; `grep -n "rise" app/globals.css` kosong.
- **Feel check**: buka modal apa pun (mis. Tambah anggota) — backdrop memudar masuk dengan kurva yang sama dengan kotak modal (kohesif, tidak ada jeda terasa antara backdrop dan modal). Tidak ada perubahan visual mencolok — ini perbaikan konsistensi.
- **Done when**: `ease-out` bawaan tidak muncul di `.modal-backdrop` dan keyframes `rise` tidak ada.
