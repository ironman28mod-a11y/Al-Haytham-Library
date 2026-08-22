/**
 * Pure utility functions for the reservation notification flow
 * triggered when a book is returned via returnLoan().
 */

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

/**
 * Find the first waiting reservation for a given book code,
 * sorted by earliest reservation date.
 *
 * Returns `null` when no reservation is pending.
 */
export function findNextReservation(
  reservations: Reservation[],
  bookCode: string,
): Reservation | null {
  const pending = reservations
    .filter((r) => r.bookCode === bookCode && r.status === "Menunggu")
    .sort((a, b) => a.reservedAt.localeCompare(b.reservedAt));
  return pending[0] ?? null;
}

/**
 * Apply the "Tersedia" status transition to a single reservation
 * in a list, leaving all other reservations untouched.
 */
export function markReservationReady(
  reservations: Reservation[],
  reservationId: string,
): Reservation[] {
  return reservations.map((r) =>
    r.id === reservationId
      ? { ...r, status: "Tersedia" as ReservationStatus }
      : r,
  );
}

/**
 * Full notification flow extracted from returnLoan's async callback.
 *
 * This function is pure — it takes all external dependencies as
 * parameters so it can be tested without mocking modules.
 *
 * @param bookCode    – the code of the book that was just returned
 * @param reservations – current reservation list
 * @param api         – object with fetchReservations, updateReservation, notifyReservation
 * @returns          – the updated reservations list (or the original if nothing changed)
 */
export async function notifyReservationOnReturn(
  bookCode: string,
  reservations: Reservation[],
  api: {
    fetchReservations: () => Promise<Reservation[]>;
    updateReservation: (id: string, updates: Partial<Reservation>) => Promise<void>;
    notifyReservation: (id: string) => Promise<void>;
  },
): Promise<Reservation[]> {
  // Re-fetch to get the latest state from the server
  const freshReservations = await api.fetchReservations();

  const firstReservation = findNextReservation(freshReservations, bookCode);
  if (!firstReservation) return reservations;

  await api.updateReservation(firstReservation.id, { status: "Tersedia" });
  await api.notifyReservation(firstReservation.id);

  return markReservationReady(reservations, firstReservation.id);
}
