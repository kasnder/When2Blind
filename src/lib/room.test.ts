import { afterEach, describe, expect, it, vi } from 'vitest';
import { aggregateRoom, availabilityFromGoogleEvents, buildRoomSlots } from './room';
import type { Room } from '../types';

const room: Room = {
  id: 'room-1',
  title: 'Planning',
  timezone: 'Europe/Amsterdam',
  startDate: '2026-03-24',
  endDate: '2026-03-25',
  startHour: 9,
  endHour: 17,
  slotMinutes: 60,
  expiresAt: '2026-04-23T20:00:00.000Z',
  createdAt: '2026-03-24T20:00:00.000Z',
};

describe('room slots', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('builds a canonical bounded-hour grid for each room day', () => {
    const slots = buildRoomSlots(room);

    expect(slots).toHaveLength(16);
    expect(slots[0]?.key).toBe('2026-03-24T09:00');
    expect(slots[7]?.key).toBe('2026-03-24T16:00');
    expect(slots[8]?.key).toBe('2026-03-25T09:00');
    expect(slots[15]?.key).toBe('2026-03-25T16:00');
  });

  it('keeps canonical slot keys stable across browser locales', () => {
    const englishKeys = buildRoomSlots(room).map((slot) => slot.key);
    const originalIntl = globalThis.Intl;
    class DutchDateTimeFormat extends originalIntl.DateTimeFormat {
      constructor(_locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        super('nl-NL', options);
      }
    }
    vi.stubGlobal('Intl', {
      ...originalIntl,
      DateTimeFormat: DutchDateTimeFormat,
    });

    const dutchKeys = buildRoomSlots(room).map((slot) => slot.key);

    expect(dutchKeys).toEqual(englishKeys);
  });

  it('accepts legacy ISO timestamp room dates without crashing', () => {
    const slots = buildRoomSlots({
      ...room,
      startDate: '2026-03-23T23:00:00.000Z',
      endDate: '2026-03-29T22:00:00.000Z',
    });

    expect(slots[0]?.key).toBe('2026-03-23T09:00');
    expect(slots.at(-1)?.key).toBe('2026-03-29T16:00');
  });

  it('falls back safely when the room timezone is invalid', () => {
    const slots = buildRoomSlots({
      ...room,
      timezone: 'Not/A_Real_Time_Zone',
      startDate: '2026-03-24',
      endDate: '2026-03-24',
    });

    expect(slots).toHaveLength(8);
    expect(slots[0]?.key).toBe('2026-03-24T09:00');
  });

  it('respects room-level daily start and end hours', () => {
    const slots = buildRoomSlots({
      ...room,
      startHour: 6,
      endHour: 12,
      startDate: '2026-03-24',
      endDate: '2026-03-24',
    });

    expect(slots).toHaveLength(6);
    expect(slots[0]?.key).toBe('2026-03-24T06:00');
    expect(slots.at(-1)?.key).toBe('2026-03-24T11:00');
  });

  it('marks partial overlaps using the room timezone instead of the host timezone', () => {
    const slots = buildRoomSlots({
      ...room,
      startDate: '2026-03-24',
      endDate: '2026-03-24',
    });

    const availability = availabilityFromGoogleEvents(
      slots,
      [
        {
          start: { dateTime: '2026-03-24T09:30:00+01:00' },
          end: { dateTime: '2026-03-24T10:15:00+01:00' },
        },
      ],
      'Europe/Amsterdam',
    );

    expect(availability['2026-03-24T09:00']).toBe(false);
    expect(availability['2026-03-24T10:00']).toBe(false);
    expect(availability['2026-03-24T11:00']).toBe(true);
  });

  it('treats all-day events as busy for the entire room day', () => {
    const slots = buildRoomSlots({
      ...room,
      startDate: '2026-03-24',
      endDate: '2026-03-24',
    });

    const availability = availabilityFromGoogleEvents(
      slots,
      [
        {
          start: { date: '2026-03-24' },
          end: { date: '2026-03-25' },
        },
      ],
      'Europe/Amsterdam',
    );

    expect(Object.values(availability).every((value) => value === false)).toBe(true);
  });

  it('computes exact and near matches from decrypted submissions', () => {
    const slots = buildRoomSlots({
      ...room,
      startDate: '2026-03-24',
      endDate: '2026-03-24',
    });

    const aggregate = aggregateRoom(slots, [
      {
        displayName: 'A',
        availabilityBySlot: {
          '2026-03-24T09:00': true,
          '2026-03-24T10:00': true,
        },
      },
      {
        displayName: 'B',
        availabilityBySlot: {
          '2026-03-24T09:00': true,
          '2026-03-24T11:00': true,
        },
      },
    ]);

    expect(aggregate.participantCount).toBe(2);
    expect(aggregate.exactMatches).toContain('2026-03-24T09:00');
    expect(aggregate.exactMatches).not.toContain('2026-03-24T10:00');
    expect(aggregate.nearMatches[0]).toEqual({ slotKey: '2026-03-24T09:00', freeCount: 2 });
    expect(aggregate.nearMatches).toEqual(
      expect.arrayContaining([
        { slotKey: '2026-03-24T10:00', freeCount: 1 },
        { slotKey: '2026-03-24T11:00', freeCount: 1 },
      ]),
    );
  });
});
