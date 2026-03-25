import { z } from 'zod';

const capabilityTypeSchema = z.enum(['organizer', 'participant']);

const printableTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\p{L}\p{N}\p{P}\p{Zs}]+$/u, 'Title contains unsupported characters.');

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => Number.isFinite(new Date(`${value}T00:00:00Z`).getTime()), 'Invalid date.');

const base64UrlSchema = z
  .string()
  .min(16)
  .max(32_768)
  .regex(/^[A-Za-z0-9_-]+$/);

const encryptionEnvelopeSchema = z.object({
  version: z.number().int().min(1).max(2),
  algorithm: z.string().min(1).max(64),
  nonce: base64UrlSchema,
  ciphertext: base64UrlSchema,
});

export const createRoomSchema = z
  .object({
    title: printableTextSchema,
    timezone: z.string().min(1).max(100),
    selectedDates: z.array(dateSchema).min(1).max(31),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
  })
  .superRefine((value, context) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value.timezone });
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timezone'],
        message: 'Invalid timezone.',
      });
    }

    const uniqueDates = new Set(value.selectedDates);
    if (uniqueDates.size !== value.selectedDates.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['selectedDates'],
        message: 'Selected dates must be unique.',
      });
    }

    if (value.startHour >= value.endHour) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endHour'],
        message: 'End hour must be after start hour.',
      });
    }
  });

export const sessionExchangeSchema = z.object({
  roomId: z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/),
  capabilityType: capabilityTypeSchema,
  capability: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
});

export const saveSubmissionSchema = z.object({
  submissionId: z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
  editToken: z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),
  envelope: encryptionEnvelopeSchema,
});

export function parseCreateRoom(input: unknown) {
  return createRoomSchema.parse(input);
}

export function parseSessionExchange(input: unknown) {
  return sessionExchangeSchema.parse(input);
}

export function parseSaveSubmission(input: unknown) {
  return saveSubmissionSchema.parse(input);
}
