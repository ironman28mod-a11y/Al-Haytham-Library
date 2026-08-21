# 002 — Gate hover transform pada tombol primary dengan media query pointer

- **Status**: TODO
- **Commit**: N/A — folder project ini bukan repo git
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file (`app/globals.css`), 1 aturan CSS

## Problem

`.button-primary:hover` menggerakkan tombol (`transform: translateY(-1px)`) tanpa gating media query pointer. Di perangkat sentuh, hover ter-trigger palsu saat tap, sehingga tombol "melompat" naik 1px saat disentuh — terasa rusak. `.book-card:hover` di file yang sama sudah di-gate dengan benar (`@media (hover: hover) and (pointer: fine)`), jadi aturan ini inkonsisten.

Kode saat ini (`app/globals.css:48`):

```css
.button-primary:hover { background: var(--green-dark); transform: translateY(-1px); }
```

## Target

Pindahkan hanya bagian transform (gerakan) ke dalam media query hover — perubahan warna tetap di luar (perubahan warna pada tap tidak bermasalah dan membantu feedback):

```css
.button-primary:hover { background: var(--green-dark); }
@media (hover: hover) and (pointer: fine) {
  .button-primary:hover { transform: translateY(-1px); }
}
```

Catatan: `.button-primary:active { transform: translateY(-1px) scale(0.97); }` TIDAK berubah — `:active` adalah feedback tekan yang sah di semua perangkat.

## Repo conventions to follow

- Pola gating sudah ada di `app/globals.css:54`: `@media (hover: hover) and (pointer: fine) { .book-card:hover { transform: translateY(-2px); box-shadow: 0 15px 35px rgba(37,65,53,.09); } }` — tiru pola ini persis.
- `.button-primary` sudah punya `transition: transform 160ms var(--ease-out), background-color .16s, ...` di aturan `.button` (`app/globals.css:48`) — transisi tetap jalan, hanya pemicu hover yang di-gate.

## Steps

1. Buka `app/globals.css`, cari `.button-primary:hover { background: var(--green-dark); transform: translateY(-1px); }` (baris ~48).
2. Ganti menjadi dua aturan: `.button-primary:hover { background: var(--green-dark); }` lalu blok `@media (hover: hover) and (pointer: fine) { .button-primary:hover { transform: translateY(-1px); } }`.
3. JANGAN ubah `.button-primary:active` atau `.button:active` — feedback tekan tetap untuk semua perangkat.

## Boundaries

- Do NOT touch `.button:active` / `.button-primary:active` — press feedback wajib tetap ada.
- Do NOT touch `.book-card` gating yang sudah benar.
- Do NOT add new dependencies.
- Jika baris tidak cocok dengan kode yang ditemukan, STOP dan laporkan.

## Verification

- **Mechanical**: `npm run typecheck` dan `npm run build` lolos.
- **Feel check**:
  - Desktop (pointer fine): hover tombol primary masih naik 1px halus.
  - DevTools → device toolbar (mode touch, mis. iPhone 375px): tap tombol primary TIDAK lagi "melompat" naik; hanya warna berubah + feedback tekan `scale(0.97)` saat ditekan.
  - DevTools Rendering → emulate `hover: none, pointer: coarse`: verifikasi `translateY` tidak diterapkan.
- **Done when**: tombol primary tidak bergerak naik pada interaksi sentuh, tapi tetap bergerak di hover desktop.
