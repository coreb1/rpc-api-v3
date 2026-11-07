import { sql } from 'drizzle-orm'
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Database tables. This is the storage shape only: repositories translate
 * rows to entities (e.g. starts_at + ends_at become one EventSchedule).
 */
const tstz = () => timestamp({ withTimezone: true, mode: 'date' })

// ---------- auth ----------
export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  createdAt: tstz().notNull().defaultNow(),
})

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 of the opaque token; the raw token is never stored. */
    tokenHash: text().notNull().unique(),
    expiresAt: tstz().notNull(),
    revokedAt: tstz(),
    createdAt: tstz().notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

// ---------- events, deals & tickets ----------
export const events = pgTable(
  'events',
  {
    id: uuid().primaryKey(),
    title: text().notNull(),
    description: text(),
    venue: text().notNull(),
    startsAt: tstz().notNull(),
    endsAt: tstz().notNull(),
    createdAt: tstz().notNull(),
    updatedAt: tstz().notNull(),
  },
  (t) => [
    index('events_starts_at_idx').on(t.startsAt),
    // The entity enforces it; the database refuses bad rows anyway.
    check('events_ends_after_start', sql`${t.endsAt} > ${t.startsAt}`),
  ],
)

export const deals = pgTable(
  'deals',
  {
    id: uuid().primaryKey(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    description: text(),
    /** Minor units (cents). With `priceCurrency`, becomes one Money. */
    priceAmount: integer().notNull(),
    priceCurrency: text().notNull(),
    quantity: integer().notNull(),
    createdAt: tstz().notNull(),
    updatedAt: tstz().notNull(),
  },
  (t) => [
    // The service checks it first for a clean error; this catches concurrent writes.
    uniqueIndex('deals_event_name_uq').on(t.eventId, sql`lower(${t.name})`),
    index('deals_event_idx').on(t.eventId, t.createdAt),
    check('deals_price_amount_non_negative', sql`${t.priceAmount} >= 0`),
    check('deals_quantity_positive', sql`${t.quantity} > 0`),
  ],
)

export const ticketStatus = pgEnum('ticket_status', ['valid', 'scanned', 'cancelled'])

export const tickets = pgTable(
  'tickets',
  {
    id: uuid().primaryKey(),
    eventId: uuid()
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    holderName: text().notNull(),
    holderEmail: text().notNull(),
    seat: text(),
    status: ticketStatus().notNull().default('valid'),
    createdAt: tstz().notNull(),
    updatedAt: tstz().notNull(),
  },
  (t) => [index('tickets_event_idx').on(t.eventId, t.createdAt)],
)

// ---------- outbox ----------
export const outboxMessages = pgTable(
  'outbox_messages',
  {
    id: uuid().primaryKey(),
    /** Insertion order: the relay publishes in this order. */
    sequence: bigserial({ mode: 'number' }).notNull(),
    type: text().notNull(),
    version: integer().notNull().default(1),
    aggregateType: text().notNull(),
    aggregateId: uuid().notNull(),
    actorId: uuid(),
    payload: jsonb().notNull(),
    occurredAt: tstz().notNull(),
    /** Next time the relay may try this message (retry backoff). */
    availableAt: tstz().notNull().defaultNow(),
    publishedAt: tstz(),
    attempts: integer().notNull().default(0),
    lastError: text(),
  },
  (t) => [
    index('outbox_pending_idx')
      .on(t.availableAt, t.sequence)
      .where(sql`${t.publishedAt} is null`),
    index('outbox_aggregate_idx').on(t.aggregateType, t.aggregateId),
  ],
)

export type EventRow = typeof events.$inferSelect
export type DealRow = typeof deals.$inferSelect
export type TicketRow = typeof tickets.$inferSelect
