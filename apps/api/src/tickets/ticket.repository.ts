import { asc, eq } from 'drizzle-orm'
import type { Database } from '../database'
import { tickets, type TicketRow } from '../schema'
import type { FindOptions, Page, PageResult } from '../shared/ports'
import { Ticket } from './ticket'
import type { TicketDetails, TicketListItem, TicketRepository } from './ticket.service'

/** The only class that knows how tickets are stored. */
export class PostgresTicketRepository implements TicketRepository {
  private static readonly LIST_COLUMNS = {
    id: tickets.id,
    holderName: tickets.holderName,
    seat: tickets.seat,
    status: tickets.status,
  }

  private static readonly DETAIL_COLUMNS = {
    ...PostgresTicketRepository.LIST_COLUMNS,
    eventId: tickets.eventId,
    holderEmail: tickets.holderEmail,
    createdAt: tickets.createdAt,
    updatedAt: tickets.updatedAt,
  }

  constructor(private readonly database: Database) {}

  // ---------- writes: full row ↔ entity ----------

  async findById(id: string, options?: FindOptions): Promise<Ticket | null> {
    const query = this.database.db.select().from(tickets).where(eq(tickets.id, id)).limit(1)
    const [row] = options?.forUpdate ? await query.for('update') : await query
    return row ? this.toEntity(row) : null
  }

  async update(ticket: Ticket): Promise<void> {
    const { id, eventId: _eventId, createdAt: _createdAt, ...changes } = this.toRow(ticket)
    await this.database.db.update(tickets).set(changes).where(eq(tickets.id, id))
  }

  async remove(id: string): Promise<void> {
    await this.database.db.delete(tickets).where(eq(tickets.id, id))
  }

  // ---------- reads: only the columns each read model needs ----------

  async listByEvent(eventId: string, { limit, offset }: Page): Promise<PageResult<TicketListItem>> {
    const byEvent = eq(tickets.eventId, eventId)
    const [items, total] = await Promise.all([
      this.database.db
        .select(PostgresTicketRepository.LIST_COLUMNS)
        .from(tickets)
        .where(byEvent)
        .orderBy(asc(tickets.createdAt), asc(tickets.id))
        .limit(limit)
        .offset(offset),
      this.database.db.$count(tickets, byEvent),
    ])
    return { items, total }
  }

  async findDetails(id: string): Promise<TicketDetails | null> {
    const [row] = await this.database.db
      .select(PostgresTicketRepository.DETAIL_COLUMNS)
      .from(tickets)
      .where(eq(tickets.id, id))
      .limit(1)
    return row ?? null
  }

  // ---------- mapping ----------

  private toEntity(row: TicketRow): Ticket {
    return Ticket.restore(row.id, {
      eventId: row.eventId,
      holderName: row.holderName,
      holderEmail: row.holderEmail,
      seat: row.seat,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }

  private toRow(ticket: Ticket): TicketRow {
    return {
      id: ticket.id,
      eventId: ticket.eventId,
      holderName: ticket.holderName,
      holderEmail: ticket.holderEmail,
      seat: ticket.seat,
      status: ticket.status,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
    }
  }
}
