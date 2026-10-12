import { BadRequestException } from '@nestjs/common';

const DEFAULT_MIN_NOTICE_MINUTES = 15;
const DEFAULT_MAX_ADVANCE_DAYS = 90;

function readPositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Booking policy is global for now and can be tuned through environment variables.
 * A slot must be in the future, at least the configured notice ahead, and no
 * further than the configured booking horizon.
 */
export function validateBookingTime(startTime: Date, now = new Date()): void {
  const timestamp = startTime.getTime();
  if (!Number.isFinite(timestamp)) {
    throw new BadRequestException('The requested appointment time is invalid.');
  }

  const differenceMs = timestamp - now.getTime();
  if (differenceMs <= 0) {
    throw new BadRequestException('Appointments cannot be booked in the past.');
  }

  const minNoticeMinutes = readPositiveNumber(
    process.env.BOOKING_MIN_NOTICE_MINUTES,
    DEFAULT_MIN_NOTICE_MINUTES,
  );
  const minNoticeMs = minNoticeMinutes * 60 * 1000;
  if (differenceMs < minNoticeMs) {
    throw new BadRequestException(
      `Appointments must be booked at least ${minNoticeMinutes} minutes in advance.`,
    );
  }

  const maxAdvanceDays = readPositiveNumber(
    process.env.BOOKING_MAX_ADVANCE_DAYS,
    DEFAULT_MAX_ADVANCE_DAYS,
  );
  const maxAdvanceMs = maxAdvanceDays * 24 * 60 * 60 * 1000;
  if (differenceMs > maxAdvanceMs) {
    throw new BadRequestException(
      `Appointments cannot be booked more than ${maxAdvanceDays} days in advance.`,
    );
  }
}
