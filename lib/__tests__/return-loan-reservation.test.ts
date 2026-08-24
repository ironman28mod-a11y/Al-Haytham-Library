import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  findNextReservation,
  markReservationReady,
  notifyReservationOnReturn,
  type Reservation,
} from '../reservation-notify'

/* ── Helpers ────────────────────────────────────────────── */

function makeReservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: `res-${Math.random().toString(36).slice(2, 8)}`,
    member: 'Nadia Putri',
    memberCode: 'AG-2024-001',
    book: 'Atomic Habits',
    bookCode: 'BK-00203',
    reservedAt: '2024-06-20',
    status: 'Menunggu',
    avatar: 'NP',
    color: '#f5d9c8',
    ...overrides,
  }
}

/* ── findNextReservation ────────────────────────────────── */

describe('findNextReservation', () => {
  it('returns the earliest waiting reservation for the book', () => {
    const reservations: Reservation[] = [
      makeReservation({ id: 'res-late', reservedAt: '2024-06-25' }),
      makeReservation({ id: 'res-early', reservedAt: '2024-06-20' }),
      makeReservation({ id: 'res-other', bookCode: 'BK-99999', reservedAt: '2024-06-10' }),
    ]

    const result = findNextReservation(reservations, 'BK-00203')
    expect(result?.id).toBe('res-early')
  })

  it('ignores reservations with non-waiting statuses', () => {
    const reservations: Reservation[] = [
      makeReservation({ id: 'res-done', status: 'Tersedia' }),
      makeReservation({ id: 'res-cancelled', status: 'Dibatalkan' }),
      makeReservation({ id: 'res-completed', status: 'Selesai' }),
    ]

    expect(findNextReservation(reservations, 'BK-00203')).toBeNull()
  })

  it('returns null when no reservations exist for the book', () => {
    const reservations: Reservation[] = [
      makeReservation({ bookCode: 'BK-11111' }),
    ]

    expect(findNextReservation(reservations, 'BK-00203')).toBeNull()
  })

  it('returns null for an empty reservation list', () => {
    expect(findNextReservation([], 'BK-00203')).toBeNull()
  })

  it('returns the single waiting reservation when only one matches', () => {
    const reservation = makeReservation({ id: 'res-only' })
    expect(findNextReservation([reservation], 'BK-00203')?.id).toBe('res-only')
  })
})

/* ── markReservationReady ───────────────────────────────── */

describe('markReservationReady', () => {
  it('sets the target reservation status to Tersedia', () => {
    const reservations: Reservation[] = [
      makeReservation({ id: 'res-1', status: 'Menunggu' }),
      makeReservation({ id: 'res-2', status: 'Menunggu' }),
    ]

    const updated = markReservationReady(reservations, 'res-1')
    expect(updated.find((r) => r.id === 'res-1')?.status).toBe('Tersedia')
  })

  it('does not mutate the original array', () => {
    const original: Reservation[] = [
      makeReservation({ id: 'res-1', status: 'Menunggu' }),
    ]

    markReservationReady(original, 'res-1')
    expect(original[0].status).toBe('Menunggu')
  })

  it('leaves other reservations untouched', () => {
    const reservations: Reservation[] = [
      makeReservation({ id: 'res-1', status: 'Menunggu' }),
      makeReservation({ id: 'res-2', status: 'Menunggu' }),
    ]

    const updated = markReservationReady(reservations, 'res-1')
    expect(updated.find((r) => r.id === 'res-2')?.status).toBe('Menunggu')
  })

  it('returns the same list when the id does not match any reservation', () => {
    const reservations: Reservation[] = [
      makeReservation({ id: 'res-1', status: 'Menunggu' }),
    ]

    const updated = markReservationReady(reservations, 'res-nonexistent')
    expect(updated[0].status).toBe('Menunggu')
  })
})

/* ── notifyReservationOnReturn ──────────────────────────── */

describe('notifyReservationOnReturn', () => {
  type MockApi = {
    fetchReservations: ReturnType<typeof vi.fn<() => Promise<Reservation[]>>>
    updateReservation: ReturnType<typeof vi.fn<(id: string, updates: Partial<Reservation>) => Promise<void>>>
    notifyReservation: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>
  }

  let mockApi: MockApi

  beforeEach(() => {
    mockApi = {
      fetchReservations: vi.fn<() => Promise<Reservation[]>>(),
      updateReservation: vi.fn<(id: string, updates: Partial<Reservation>) => Promise<void>>(),
      notifyReservation: vi.fn<(id: string) => Promise<void>>(),
    }
  })

  it('updates the first waiting reservation to Tersedia and calls notify', async () => {
    const reservations: Reservation[] = [
      makeReservation({ id: 'res-1', reservedAt: '2024-06-20' }),
      makeReservation({ id: 'res-2', reservedAt: '2024-06-25' }),
    ]

    mockApi.fetchReservations.mockResolvedValue(reservations)

    const result = await notifyReservationOnReturn('BK-00203', reservations, mockApi)

    expect(mockApi.updateReservation).toHaveBeenCalledWith('res-1', { status: 'Tersedia' })
    expect(mockApi.notifyReservation).toHaveBeenCalledWith('res-1')
    expect(result.find((r) => r.id === 'res-1')?.status).toBe('Tersedia')
  })

  it('does not call update or notify when there are no waiting reservations', async () => {
    mockApi.fetchReservations.mockResolvedValue([])

    const result = await notifyReservationOnReturn('BK-00203', [], mockApi)

    expect(mockApi.updateReservation).not.toHaveBeenCalled()
    expect(mockApi.notifyReservation).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('only notifies the earliest reservation, not later ones', async () => {
    const reservations: Reservation[] = [
      makeReservation({ id: 'res-late', reservedAt: '2024-06-25' }),
      makeReservation({ id: 'res-early', reservedAt: '2024-06-20' }),
    ]

    mockApi.fetchReservations.mockResolvedValue(reservations)

    await notifyReservationOnReturn('BK-00203', reservations, mockApi)

    expect(mockApi.updateReservation).toHaveBeenCalledTimes(1)
    expect(mockApi.updateReservation).toHaveBeenCalledWith('res-early', { status: 'Tersedia' })
    expect(mockApi.notifyReservation).toHaveBeenCalledTimes(1)
  })

  it('skips reservations for other books', async () => {
    const reservations: Reservation[] = [
      makeReservation({ id: 'res-wrong', bookCode: 'BK-99999', reservedAt: '2024-06-20' }),
    ]

    mockApi.fetchReservations.mockResolvedValue(reservations)

    const result = await notifyReservationOnReturn('BK-00203', [], mockApi)

    expect(mockApi.updateReservation).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('returns the original list unchanged when fetchReservations throws', async () => {
    const reservations: Reservation[] = [
      makeReservation({ id: 'res-1' }),
    ]

    mockApi.fetchReservations.mockRejectedValue(new Error('Network error'))

    await expect(
      notifyReservationOnReturn('BK-00203', reservations, mockApi),
    ).rejects.toThrow('Network error')
  })

  it('applies the Tersedia status only to the first reservation in the returned list', async () => {
    const reservations: Reservation[] = [
      makeReservation({ id: 'res-1', reservedAt: '2024-06-20' }),
      makeReservation({ id: 'res-2', reservedAt: '2024-06-25' }),
    ]

    mockApi.fetchReservations.mockResolvedValue(reservations)

    const result = await notifyReservationOnReturn('BK-00203', reservations, mockApi)

    expect(result.find((r) => r.id === 'res-1')?.status).toBe('Tersedia')
    expect(result.find((r) => r.id === 'res-2')?.status).toBe('Menunggu')
  })

  it('handles the case where updateReservation is called before notifyReservation', async () => {
    const callOrder: string[] = []
    mockApi.fetchReservations.mockResolvedValue([
      makeReservation({ id: 'res-1', reservedAt: '2024-06-20' }),
    ])
    mockApi.updateReservation.mockImplementation(async () => {
      callOrder.push('update')
    })
    mockApi.notifyReservation.mockImplementation(async () => {
      callOrder.push('notify')
    })

    await notifyReservationOnReturn('BK-00203', [], mockApi)

    expect(callOrder).toEqual(['update', 'notify'])
  })

  it('skips already-notified (Tersedia) reservations even if they exist', async () => {
    const reservations: Reservation[] = [
      makeReservation({ id: 'res-notified', status: 'Tersedia', reservedAt: '2024-06-20' }),
      makeReservation({ id: 'res-waiting', status: 'Menunggu', reservedAt: '2024-06-25' }),
    ]

    mockApi.fetchReservations.mockResolvedValue(reservations)

    const result = await notifyReservationOnReturn('BK-00203', reservations, mockApi)

    expect(mockApi.updateReservation).toHaveBeenCalledWith('res-waiting', { status: 'Tersedia' })
    expect(mockApi.notifyReservation).toHaveBeenCalledWith('res-waiting')
    expect(result.find((r) => r.id === 'res-notified')?.status).toBe('Tersedia')
    expect(result.find((r) => r.id === 'res-waiting')?.status).toBe('Tersedia')
  })
})
