import { BadRequestException } from '@nestjs/common';
import { validateBookingTime } from './booking-time-policy';

describe('validateBookingTime', () => {
  const now = new Date('2026-10-11T12:00:00.000Z');
  const originalMinNotice = process.env.BOOKING_MIN_NOTICE_MINUTES;
  const originalMaxAdvance = process.env.BOOKING_MAX_ADVANCE_DAYS;

  afterEach(() => {
    if (originalMinNotice === undefined)
      delete process.env.BOOKING_MIN_NOTICE_MINUTES;
    else process.env.BOOKING_MIN_NOTICE_MINUTES = originalMinNotice;
    if (originalMaxAdvance === undefined)
      delete process.env.BOOKING_MAX_ADVANCE_DAYS;
    else process.env.BOOKING_MAX_ADVANCE_DAYS = originalMaxAdvance;
  });

  it('rejects invalid dates', () => {
    expect(() => validateBookingTime(new Date('invalid'), now)).toThrow(
      new BadRequestException('The requested appointment time is invalid.'),
    );
  });

  it('rejects times in the past and the current instant', () => {
    expect(() =>
      validateBookingTime(new Date('2026-10-11T11:59:59.999Z'), now),
    ).toThrow('Appointments cannot be booked in the past.');
    expect(() => validateBookingTime(now, now)).toThrow(
      'Appointments cannot be booked in the past.',
    );
  });

  it('requires the configured minimum notice', () => {
    process.env.BOOKING_MIN_NOTICE_MINUTES = '30';
    expect(() =>
      validateBookingTime(new Date('2026-10-11T12:29:59.999Z'), now),
    ).toThrow('Appointments must be booked at least 30 minutes in advance.');
    expect(() =>
      validateBookingTime(new Date('2026-10-11T12:30:00.000Z'), now),
    ).not.toThrow();
  });

  it('rejects bookings beyond the configured maximum horizon', () => {
    process.env.BOOKING_MIN_NOTICE_MINUTES = '0';
    process.env.BOOKING_MAX_ADVANCE_DAYS = '2';
    expect(() =>
      validateBookingTime(new Date('2026-10-13T12:00:00.001Z'), now),
    ).toThrow('Appointments cannot be booked more than 2 days in advance.');
    expect(() =>
      validateBookingTime(new Date('2026-10-13T12:00:00.000Z'), now),
    ).not.toThrow();
  });

  it('uses a 15-minute minimum notice and 90-day horizon by default', () => {
    delete process.env.BOOKING_MIN_NOTICE_MINUTES;
    delete process.env.BOOKING_MAX_ADVANCE_DAYS;
    expect(() =>
      validateBookingTime(new Date('2026-10-11T12:14:59.999Z'), now),
    ).toThrow('Appointments must be booked at least 15 minutes in advance.');
    expect(() =>
      validateBookingTime(new Date('2027-01-10T12:00:00.001Z'), now),
    ).toThrow('Appointments cannot be booked more than 90 days in advance.');
  });
});
