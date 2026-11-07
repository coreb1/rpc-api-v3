import { z } from 'zod'

export const ConfigSchema = z.object({
  DATABASE_URL: z.url(),
  PORT: z.coerce.number().int().default(3000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
})

export type Config = z.infer<typeof ConfigSchema>
