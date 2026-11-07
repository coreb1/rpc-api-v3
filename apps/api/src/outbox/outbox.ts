import { and, asc, eq, isNull, lt, lte } from 'drizzle-orm'
import type { Database } from '../database'
import { outboxMessages } from '../schema'
import type { DomainEvent } from '../shared/domain'
import type { Actor, OutboxWriter } from '../shared/ports'

/** What a queue receives. `id` is the idempotency key for consumers. */
export interface OutboxMessage {
  id: string
  type: string
  version: number
  aggregateType: string
  aggregateId: string
  actorId: string | null
  occurredAt: Date
  payload: unknown
}

export interface MessagePublisher {
  publish(message: OutboxMessage): Promise<void>
}

/** Writes domain events as outbox rows, inside the caller's transaction. */
export class PostgresOutboxWriter implements OutboxWriter {
  constructor(private readonly database: Database) {}

  async append(events: readonly DomainEvent[], actor: Actor | null): Promise<void> {
    if (events.length === 0) return
    await this.database.db.insert(outboxMessages).values(
      events.map((event) => ({
        id: crypto.randomUUID(),
        type: event.type,
        version: event.version,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        actorId: actor?.userId ?? null,
        payload: event.payload,
        occurredAt: event.occurredAt,
      })),
    )
  }
}

/** Placeholder until a real queue is wired (SQS, Pub/Sub, NATS…). */
export class LoggingMessagePublisher implements MessagePublisher {
  async publish(message: OutboxMessage): Promise<void> {
    console.info(
      `[queue] ${message.type}@v${message.version} ${message.aggregateType}/${message.aggregateId} (${message.id})`,
    )
  }
}

export interface OutboxRelayOptions {
  batchSize: number
  pollIntervalMs: number
  /** After this many failures a message is parked (dead letter) and needs manual action. */
  maxAttempts: number
}

/**
 * Polls pending outbox rows and publishes them in insertion order.
 * `FOR UPDATE SKIP LOCKED` lets several relays run side by side without
 * double-publishing. Delivery is at-least-once: consumers dedupe on message id.
 */
export class OutboxRelay {
  private stopped = true
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly database: Database,
    private readonly publisher: MessagePublisher,
    private readonly options: OutboxRelayOptions,
  ) {}

  /** Processes one batch. Returns how many rows it picked up. */
  tick(): Promise<number> {
    return this.database.run(async () => {
      const db = this.database.db
      const batch = await db
        .select()
        .from(outboxMessages)
        .where(
          and(
            isNull(outboxMessages.publishedAt),
            lte(outboxMessages.availableAt, new Date()),
            lt(outboxMessages.attempts, this.options.maxAttempts),
          ),
        )
        .orderBy(asc(outboxMessages.sequence))
        .limit(this.options.batchSize)
        .for('update', { skipLocked: true })

      for (const row of batch) {
        try {
          await this.publisher.publish(row)
          await db
            .update(outboxMessages)
            .set({ publishedAt: new Date(), attempts: row.attempts + 1, lastError: null })
            .where(eq(outboxMessages.id, row.id))
        } catch (error) {
          console.error(`[outbox] publish failed for ${row.id}`, error)
          await db
            .update(outboxMessages)
            .set({
              attempts: row.attempts + 1,
              lastError: error instanceof Error ? error.message : String(error),
              availableAt: new Date(Date.now() + Math.min(60_000, 500 * 2 ** row.attempts)),
            })
            .where(eq(outboxMessages.id, row.id))
        }
      }
      return batch.length
    })
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.loop()
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
  }

  private async loop(): Promise<void> {
    let picked = 0
    try {
      picked = await this.tick()
    } catch (error) {
      console.error('[outbox] tick failed', error)
    }
    // Drain immediately while there's a backlog, otherwise wait.
    const delay = picked === this.options.batchSize ? 0 : this.options.pollIntervalMs
    if (!this.stopped) this.timer = setTimeout(() => void this.loop(), delay)
  }
}
