import { NotFoundError } from '../shared/domain'
import type { Actor, FindOptions, OutboxWriter, Page, PageResult, Transaction } from '../shared/ports'
import { Event, type EventChanges, type NewEvent } from './event'

/** Read models: plain data shaped for what a screen needs. */
export interface EventSummary {
  id: string
  title: string
  venue: string
  startsAt: Date
  endsAt: Date
}

export interface EventDetails extends EventSummary {
  description: string | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Port implemented by PostgresEventRepository.
 * Writes use the full entity (so rules always run); reads return read models
 * and select only the columns they need.
 */
export interface EventRepository {
  findById(id: string, options?: FindOptions): Promise<Event | null>
  add(event: Event): Promise<void>
  update(event: Event): Promise<void>
  remove(id: string): Promise<void>

  listSummaries(page: Page): Promise<PageResult<EventSummary>>
  findDetails(id: string): Promise<EventDetails | null>
  /**
   * `lockAgainstDelete` (SELECT … FOR KEY SHARE): the event can't be deleted until the
   * caller's transaction ends, so rows that reference it can be added safely. Edits still go through.
   */
  exists(id: string, options?: { lockAgainstDelete?: boolean }): Promise<boolean>
}

/** Everything you can do with events. One method per use case. */
export class EventService {
  constructor(
    private readonly events: EventRepository,
    private readonly outbox: OutboxWriter,
    private readonly tx: Transaction,
  ) {}

  // ---------- queries: read models straight from the repository ----------

  list(page: Page): Promise<PageResult<EventSummary>> {
    return this.events.listSummaries(page)
  }

  async get(id: string): Promise<EventDetails> {
    const event = await this.events.findDetails(id)
    if (!event) throw new NotFoundError('event', id)
    return event
  }

  // ---------- commands: load the entity, apply the rule, save + outbox in one transaction ----------

  async create(input: NewEvent, actor: Actor): Promise<EventDetails> {
    const event = Event.create(input)
    await this.tx.run(async () => {
      await this.events.add(event)
      await this.outbox.append(event.pullEvents(), actor)
    })
    return this.toDetails(event)
  }

  update(id: string, changes: EventChanges, actor: Actor): Promise<EventDetails> {
    return this.tx.run(async () => {
      const event = await this.load(id)
      event.update(changes)
      const facts = event.pullEvents()
      if (facts.length > 0) {
        await this.events.update(event)
        await this.outbox.append(facts, actor)
      }
      return this.toDetails(event)
    })
  }

  delete(id: string, actor: Actor): Promise<void> {
    return this.tx.run(async () => {
      const event = await this.load(id)
      event.delete()
      await this.events.remove(id) // deals and tickets are removed by the FK cascade
      await this.outbox.append(event.pullEvents(), actor)
    })
  }

  private async load(id: string): Promise<Event> {
    const event = await this.events.findById(id, { forUpdate: true })
    if (!event) throw new NotFoundError('event', id)
    return event
  }

  private toDetails(event: Event): EventDetails {
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
