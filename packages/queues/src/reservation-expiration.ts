import { Queue, Worker, type Processor } from "bullmq";
import { getRedisConnection } from "./connection";

export const RESERVATION_EXPIRATION_QUEUE = "reservation-expiration";
export const RESERVATION_RECONCILIATION_JOB_ID = "reconcile-expired-reservations";

export interface ReservationExpirationJobData {
  reservationId: string;
}

export function createReservationExpirationQueue() {
  return new Queue<ReservationExpirationJobData>(RESERVATION_EXPIRATION_QUEUE, {
    connection: getRedisConnection(),
  });
}

export function createReservationExpirationWorker(
  processor: Processor<ReservationExpirationJobData>,
) {
  return new Worker<ReservationExpirationJobData>(RESERVATION_EXPIRATION_QUEUE, processor, {
    connection: getRedisConnection(),
  });
}
