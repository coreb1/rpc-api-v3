import type { EventRepository } from '../events/event.service'
import { NotFoundError } from '../shared/domain'
import type { Actor, FindOptions, OutboxWriter, Page, PageResult, Transaction } from '../shared/ports'
import type { Ticket, TicketChanges, TicketStatus } from './ticket'

/** Read models. The list item has no email: lighter, and less PII on list screens. */
export interface TicketListItem {
  id: string
  holderName: string
  seat: string | null
  status: TicketStatus
}

export interface TicketDetails extends TicketListItem {
  eventId: string
  holderEmail: string
  createdAt: Date
  updatedAt: Date
}

/** Port implemented by PostgresTicketRepository. */
export interface TicketRepository {
  findById(id: string, options?: FindOptions): Promise<Ticket | null>
  update(ticket: Ticket): Promise<void>
  remove(id: string): Promise<void>

  listByEvent(eventId: string, page: Page): Promise<PageResult<TicketListItem>>
  findDetails(id: string): Promise<TicketDetails | null>
}

/** Everything you can do with tickets. One method per use case. */
export class TicketService {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly events: EventRepository,
    private readonly outbox: OutboxWriter,
    private readonly tx: Transaction,
  ) {}

  // ---------- queries ----------

  async listByEvent(eventId: string, page: Page): Promise<PageResult<TicketListItem>> {
    if (!(await this.events.exists(eventId))) throw new NotFoundError('event', eventId)
    return this.tickets.listByEvent(eventId, page)
  }

  async get(id: string): Promise<TicketDetails> {
    const ticket = await this.tickets.findDetails(id)
    if (!ticket) throw new NotFoundError('ticket', id)
    return ticket
  }

  // ---------- commands ----------

  update(id: string, changes: TicketChanges, actor: Actor): Promise<TicketDetails> {
    return this.tx.run(async () => {
      const ticket = await this.load(id)
      ticket.update(changes)
      const facts = ticket.pullEvents()
      if (facts.length > 0) {
        await this.tickets.update(ticket)
        await this.outbox.append(facts, actor)
      }
      return this.toDetails(ticket)
    })
  }

  delete(id: string, actor: Actor): Promise<void> {
    return this.tx.run(async () => {
      const ticket = await this.load(id)
      ticket.delete()
      await this.tickets.remove(id)
      await this.outbox.append(ticket.pullEvents(), actor)
    })
  }

  private async load(id: string): Promise<Ticket> {
    const ticket = await this.tickets.findById(id, { forUpdate: true })
    if (!ticket) throw new NotFoundError('ticket', id)
    return ticket
  }

  private toDetails(ticket: Ticket): TicketDetails {
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
