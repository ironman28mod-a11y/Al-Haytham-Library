import { test, expect } from '@playwright/test'

// Helper to login as admin
async function loginAsAdmin(page: any) {
  await page.goto('/login')
  await page.fill('input[placeholder="Masukkan username"]', 'admin.alhaytham')
  await page.fill('input[placeholder="Masukkan password"]', 'AlHaytham123!')
  await page.click('button[type="submit"]')
  await page.waitForURL('/')
}

test.describe('Reservation Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('should display reservation page in sidebar', async ({ page }) => {
    // Check that Reservasi menu item exists in sidebar
    const reservasiButton = page.locator('button.nav-item', { hasText: 'Reservasi' })
    await expect(reservasiButton).toBeVisible()
  })

  test('should navigate to reservation page', async ({ page }) => {
    // Click on Reservasi menu
    await page.click('button.nav-item:has-text("Reservasi")')
    
    // Should show reservation page header
    await expect(page.locator('h1', { hasText: 'Reservasi buku' })).toBeVisible()
  })

  test('should show empty state when no reservations', async ({ page }) => {
    // Navigate to reservations
    await page.click('button.nav-item:has-text("Reservasi")')
    
    // Should show empty state
    await expect(page.locator('h3', { hasText: 'Belum ada reservasi' })).toBeVisible()
  })

  test('should show reservation stats', async ({ page }) => {
    // Navigate to reservations
    await page.click('button.nav-item:has-text("Reservasi")')
    
    // Should show stat cards
    await expect(page.locator('text=Menunggu')).toBeVisible()
    await expect(page.locator('text=Tersedia diambil')).toBeVisible()
  })

  test('should show reserve button on out-of-stock books', async ({ page }) => {
    // Navigate to books catalog
    await page.click('button.nav-item:has-text("Katalog Buku")')
    
    // Look for a book that might be out of stock
    const outOfStockBook = page.locator('span.stock-label.out').first()
    
    // If there's an out-of-stock book, check for reserve button
    if (await outOfStockBook.isVisible()) {
      const reserveButton = page.locator('button:has-text("Reservasi buku")').first()
      await expect(reserveButton).toBeVisible()
    }
  })

  test('should create reservation when clicking reserve button', async ({ page }) => {
    // Navigate to books catalog
    await page.click('button.nav-item:has-text("Katalog Buku")')
    
    // Find an out-of-stock book
    const outOfStockCard = page.locator('article.book-card').filter({ has: page.locator('span.stock-label.out') }).first()
    
    if (await outOfStockCard.isVisible()) {
      // Click reserve button
      await outOfStockCard.locator('button:has-text("Reservasi buku")').click()
      
      // Should show success message
      await expect(page.locator('text=Berhasil mengantri')).toBeVisible()
      
      // Button should change to "Sudah dalam antrian"
      await expect(outOfStockCard.locator('text=Sudah dalam antrian')).toBeVisible()
    }
  })

  test('should show reservation in reservations page after creation', async ({ page }) => {
    // Navigate to books catalog
    await page.click('button.nav-item:has-text("Katalog Buku")')
    
    // Find an out-of-stock book and reserve it
    const outOfStockCard = page.locator('article.book-card').filter({ has: page.locator('span.stock-label.out') }).first()
    
    if (await outOfStockCard.isVisible()) {
      await outOfStockCard.locator('button:has-text("Reservasi buku")').click()
      
      // Navigate to reservations page
      await page.click('button.nav-item:has-text("Reservasi")')
      
      // Should show the reservation in the table
      await expect(page.locator('table tbody tr')).toHaveCount(1)
    }
  })

  test('should show filter options on reservations page', async ({ page }) => {
    // Navigate to reservations
    await page.click('button.nav-item:has-text("Reservasi")')
    
    // Should show filter dropdown
    await expect(page.locator('select')).toBeVisible()
    
    // Should have status options
    const select = page.locator('select').first()
    await expect(select.locator('option', { hasText: 'Semua status' })).toBeVisible()
    await expect(select.locator('option', { hasText: 'Menunggu' })).toBeVisible()
    await expect(select.locator('option', { hasText: 'Tersedia' })).toBeVisible()
  })

  test('should show cancel button for waiting reservations', async ({ page }) => {
    // Navigate to reservations
    await page.click('button.nav-item:has-text("Reservasi")')
    
    // If there are waiting reservations, should show cancel button
    const waitingRow = page.locator('tr', { hasText: 'Menunggu' }).first()
    if (await waitingRow.isVisible()) {
      await expect(waitingRow.locator('button:has-text("Batal")')).toBeVisible()
    }
  })

  test('should cancel reservation when clicking cancel button', async ({ page }) => {
    // Navigate to books catalog and create a reservation first
    await page.click('button.nav-item:has-text("Katalog Buku")')
    
    const outOfStockCard = page.locator('article.book-card').filter({ has: page.locator('span.stock-label.out') }).first()
    
    if (await outOfStockCard.isVisible()) {
      await outOfStockCard.locator('button:has-text("Reservasi buku")').click()
      
      // Navigate to reservations
      await page.click('button.nav-item:has-text("Reservasi")')
      
      // Click cancel button
      await page.locator('button:has-text("Batal")').first().click()
      
      // Should show empty state again
      await expect(page.locator('h3', { hasText: 'Belum ada reservasi' })).toBeVisible()
    }
  })

  test('should show notification bell with count', async ({ page }) => {
    // Check notification bell exists
    const notificationButton = page.locator('button[aria-label="Notifikasi"]')
    await expect(notificationButton).toBeVisible()
  })

  test('should open notification panel', async ({ page }) => {
    // Click notification bell
    await page.click('button[aria-label="Notifikasi"]')
    
    // Should show notification panel
    await expect(page.locator('.notification-panel')).toBeVisible()
    await expect(page.locator('text=Notifikasi')).toBeVisible()
  })

  test('should show reservation notifications when available', async ({ page }) => {
    // Click notification bell
    await page.click('button[aria-label="Notifikasi"]')
    
    // Should show notification items (may be empty or have content)
    await expect(page.locator('.notification-list')).toBeVisible()
  })

  test('should navigate to reservations from notification', async ({ page }) => {
    // Click notification bell
    await page.click('button[aria-label="Notifikasi"]')
    
    // If there are ready reservations, click on one
    const readyNotification = page.locator('.notification-item', { hasText: 'Buku tersedia' }).first()
    if (await readyNotification.isVisible()) {
      await readyNotification.click()
      
      // Should navigate to reservations page
      await expect(page.locator('h1', { hasText: 'Reservasi buku' })).toBeVisible()
    }
  })

  test('should show search box on reservations page', async ({ page }) => {
    // Navigate to reservations
    await page.click('button.nav-item:has-text("Reservasi")')
    
    // Should show search input
    await expect(page.locator('input[placeholder*="Cari"]')).toBeVisible()
  })

  test('should filter reservations by search', async ({ page }) => {
    // Navigate to reservations
    await page.click('button.nav-item:has-text("Reservasi")')
    
    // Type in search box
    const searchInput = page.locator('input[placeholder*="Cari"]')
    await searchInput.fill('test')
    
    // Results should be filtered (may show empty state)
    await expect(page.locator('.empty-state, table tbody tr')).toBeVisible()
  })
})
