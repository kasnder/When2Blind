import type { DecryptedSubmission, Room, RoomAggregate } from '../types';
import type { EventItem } from './google';

export type RoomSlot = {
  key: string;
  dateKey: string;
  dateLabel: string;
  timeLabel: string;
  dayIndex: number;
  hour: number;
};

export function buildRoomSlots(room: Room) {
  const normalizedStartDate = normalizeDateKey(room.startDate);
  const normalizedEndDate = normalizeDateKey(room.endDate);
  const safeTimeZone = normalizeTimeZone(room.timezone);
  const startHour = normalizeHour(room.startHour, 9);
  const endHour = normalizeHour(room.endHour, 17);
  const slots: RoomSlot[] = [];
  let dateKey = normalizedStartDate;
  let dayIndex = 0;

  while (dateKey <= normalizedEndDate) {
    for (let hour = startHour; hour < endHour; hour += 1) {
      const slotDate = roomLocalSlotToUtc(dateKey, hour, safeTimeZone);
      slots.push({
        key: `${dateKey}T${String(hour).padStart(2, '0')}:00`,
        dateKey,
        dateLabel: new Intl.DateTimeFormat(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          timeZone: safeTimeZone,
        }).format(slotDate),
        timeLabel: new Intl.DateTimeFormat(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: safeTimeZone,
        }).format(slotDate),
        dayIndex,
        hour,
      });
    }

    dateKey = incrementDate(dateKey);
    dayIndex += 1;
  }

  return slots;
}

export function buildEmptyAvailability(slots: RoomSlot[]) {
  return Object.fromEntries(slots.map((slot) => [slot.key, false])) as Record<string, boolean>;
}

export function availabilityFromGoogleEvents(slots: RoomSlot[], events: EventItem[], timeZone: string) {
  const availability = buildEmptyAvailability(slots);
  const safeTimeZone = normalizeTimeZone(timeZone);

  for (const slot of slots) {
    const slotStart = roomLocalSlotToUtc(slot.dateKey, slot.hour, safeTimeZone);
    const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
    const isBusy = events.some((event) => eventOverlaps(event, slotStart, slotEnd));
    availability[slot.key] = !isBusy;
  }

  return availability;
}

export function aggregateRoom(slots: RoomSlot[], submissions: DecryptedSubmission[]): RoomAggregate {
  const participantCount = submissions.length;
  const freeCounts = slots.map((slot) => {
    const displayNames = submissions
      .filter((submission) => submission.availabilityBySlot[slot.key])
      .map((submission) => submission.displayName.trim())
      .filter(Boolean);

    return {
      slotKey: slot.key,
      freeCount: displayNames.length,
      displayNames,
    };
  });

  return {
    participantCount,
    exactMatches: freeCounts.filter((entry) => participantCount > 0 && entry.freeCount === participantCount).map((entry) => entry.slotKey),
    nearMatches: freeCounts.filter((entry) => entry.freeCount > 0).sort((left, right) => right.freeCount - left.freeCount),
  };
}

function eventOverlaps(event: EventItem, slotStart: Date, slotEnd: Date) {
  const startValue = event.start?.dateTime ?? event.start?.date;
  const endValue = event.end?.dateTime ?? event.end?.date;
  if (!startValue || !endValue) {
    return false;
  }

  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const start = new Date(allDay ? `${startValue}T00:00:00` : startValue);
  const end = new Date(allDay ? `${endValue}T00:00:00` : endValue);

  return start < slotEnd && end > slotStart;
}

function incrementDate(dateKey: string) {
  const value = new Date(`${dateKey}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function roomLocalSlotToUtc(dateKey: string, hour: number, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const [year, month, day] = dateKey.split('-').map(Number);
  let guess = new Date(Date.UTC(year, month - 1, day, hour, 0, 0, 0));

  for (let index = 0; index < 4; index += 1) {
    const parts = getPartsInTimeZone(guess, timeZone);
    const targetMinutes = Date.UTC(year, month - 1, day, hour, 0, 0, 0) / 60000;
    const actualMinutes =
      Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0) / 60000;
    const diffMinutes = targetMinutes - actualMinutes;

    if (diffMinutes === 0) {
      return guess;
    }

    guess = new Date(guess.getTime() + diffMinutes * 60_000);
  }

  return guess;
}

function getPartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
  };
}

function normalizeDateKey(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1];
  }

  const parsed = new Date(value);
  if (Number.isFinite(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return new Date().toISOString().slice(0, 10);
}

function normalizeTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return value;
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
}

function normalizeHour(value: number, fallback: number) {
  return Number.isInteger(value) ? value : fallback;
}
