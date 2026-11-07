import { desc, eq, sql } from 'drizzle-orm'
import type { Database } from '../database'
import { events, type EventRow } from '../schema'
import type { FindOptions, Page, PageResult } from '../shared/ports'
import { Event, EventSchedule } from './event'
import type { EventDetails, EventRepository, EventSummary } from './event.service'

/** The only class that knows how events are stored. */
export class PostgresEventRepository implements EventRepository {
  private static readonly SUMMARY_COLUMNS = {
    id: events.id,
    title: events.title,
    venue: events.venue,
    startsAt: events.startsAt,
    endsAt: events.endsAt,
  }

  private static readonly DETAIL_COLUMNS = {
    ...PostgresEventRepository.SUMMARY_COLUMNS,
    description: events.description,
    createdAt: events.createdAt,
    updatedAt: events.updatedAt,
  }

  constructor(private readonly database: Database) {}

  // ---------- writes: full row ↔ entity ----------

  async findById(id: string, options?: FindOptions): Promise<Event | null> {
    const query = this.database.db.select().from(events).where(eq(events.id, id)).limit(1)
    const [row] = options?.forUpdate ? await query.for('update') : await query
    return row ? this.toEntity(row) : null
  }

  async add(event: Event): Promise<void> {
    await this.database.db.insert(events).values(this.toRow(event))
  }

  async update(event: Event): Promise<void> {
    const { id, createdAt: _createdAt, ...changes } = this.toRow(event)
    await this.database.db.update(events).set(changes).where(eq(events.id, id))
  }

  async remove(id: string): Promise<void> {
    await this.database.db.delete(events).where(eq(events.id, id))
  }

  // ---------- reads: only the columns each read model needs ----------

  async listSummaries({ limit, offset }: Page): Promise<PageResult<EventSummary>> {
    const [items, total] = await Promise.all([
      this.database.db
        .select(PostgresEventRepository.SUMMARY_COLUMNS)
        .from(events)
        .orderBy(desc(events.startsAt), desc(events.id))
        .limit(limit)
        .offset(offset),
      this.database.db.$count(events),
    ])
    return { items, total }
  }

  async findDetails(id: string): Promise<EventDetails | null> {
    const [row] = await this.database.db
      .select(PostgresEventRepository.DETAIL_COLUMNS)
      .from(events)
      .where(eq(events.id, id))
      .limit(1)
    return row ?? null
  }

  async exists(id: string, options?: { lockAgainstDelete?: boolean }): Promise<boolean> {
    const query = this.database.db.select({ found: sql<number>`1` }).from(events).where(eq(events.id, id)).limit(1)
    const [row] = options?.lockAgainstDelete ? await query.for('key share') : await query
    return row !== undefined
  }

  // ---------- mapping: two columns ↔ one EventSchedule ----------

  private toEntity(row: EventRow): Event {
    return Event.restore(row.id, {
      title: row.title,
      description: row.description,
      venue: row.venue,
      schedule: EventSchedule.of(row.startsAt, row.endsAt),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }

  private toRow(event: Event): EventRow {
    return {
      id: event.id,
      title: event.title,
      description: event.description,
      venue: event.venue,
      startsAt: event.schedule.startsAt,
      endsAt: event.schedule.endsAt,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    }
  }
}
