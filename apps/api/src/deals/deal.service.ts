import type { EventRepository } from '../events/event.service'
import { NotFoundError } from '../shared/domain'
import type { Actor, FindOptions, OutboxWriter, Page, PageResult, Transaction } from '../shared/ports'
import { Deal, DealNameTaken, type DealChanges, type NewDeal } from './deal'

/** Read models. */
export interface DealListItem {
  id: string
  name: string
  price: { amount: number; currency: string }
  quantity: number
}

export interface DealDetails extends DealListItem {
  eventId: string
  description: string | null
  createdAt: Date
  updatedAt: Date
}

/** Port implemented by PostgresDealRepository. */
export interface DealRepository {
  findById(id: string, options?: FindOptions): Promise<Deal | null>
  /** Throws DealNameTaken if a concurrent write took the name first. */
  add(deal: Deal): Promise<void>
  /** Throws DealNameTaken if a concurrent write took the name first. */
  update(deal: Deal): Promise<void>
  remove(id: string): Promise<void>
  /** Case-insensitive. `exceptId` lets a deal keep its own name. */
  nameTaken(eventId: string, name: string, exceptId?: string): Promise<boolean>

  listByEvent(eventId: string, page: Page): Promise<PageResult<DealListItem>>
  findDetails(id: string): Promise<DealDetails | null>
}

/** Everything you can do with deals. One method per use case. */
export class DealService {
  constructor(
    private readonly deals: DealRepository,
    private readonly events: EventRepository,
    private readonly outbox: OutboxWriter,
    private readonly tx: Transaction,
  ) {}

  // ---------- queries ----------

  async listByEvent(eventId: string, page: Page): Promise<PageResult<DealListItem>> {
    if (!(await this.events.exists(eventId))) throw new NotFoundError('event', eventId)
    return this.deals.listByEvent(eventId, page)
  }

  async get(id: string): Promise<DealDetails> {
    const deal = await this.deals.findDetails(id)
    if (!deal) throw new NotFoundError('deal', id)
    return deal
  }

  // ---------- commands ----------

  /**
   * Rules, in order:
   * 1. the fields are valid (the entity, before touching the database)
   * 2. the event exists, and stays until we commit
   * 3. no other deal of this event has the same name
   */
  async create(input: NewDeal, actor: Actor): Promise<DealDetails> {
    const deal = Deal.create(input)
    await this.tx.run(async () => {
      if (!(await this.events.exists(deal.eventId, { lockAgainstDelete: true }))) {
        throw new NotFoundError('event', deal.eventId)
      }
      await this.assertNameFree(deal)
      await this.deals.add(deal)
      await this.outbox.append(deal.pullEvents(), actor)
    })
    return this.toDetails(deal)
  }

  update(id: string, changes: DealChanges, actor: Actor): Promise<DealDetails> {
    return this.tx.run(async () => {
      const deal = await this.load(id)
      deal.update(changes)
      const facts = deal.pullEvents()
      if (facts.length > 0) {
        if (changes.name !== undefined) await this.assertNameFree(deal)
        await this.deals.update(deal)
        await this.outbox.append(facts, actor)
      }
      return this.toDetails(deal)
    })
  }

  delete(id: string, actor: Actor): Promise<void> {
    return this.tx.run(async () => {
      const deal = await this.load(id)
      deal.delete()
      await this.deals.remove(id)
      await this.outbox.append(deal.pullEvents(), actor)
    })
  }

  private async assertNameFree(deal: Deal): Promise<void> {
    if (await this.deals.nameTaken(deal.eventId, deal.name, deal.id)) throw new DealNameTaken(deal.name)
  }

  private async load(id: string): Promise<Deal> {
    const deal = await this.deals.findById(id, { forUpdate: true })
    if (!deal) throw new NotFoundError('deal', id)
    return deal
  }

  private toDetails(deal: Deal): DealDetails {
    return {
      id: deal.id,
      eventId: deal.eventId,
      name: deal.name,
      description: deal.description,
      price: deal.price.toPlain(),
      quantity: deal.quantity,
      createdAt: deal.createdAt,
      updatedAt: deal.updatedAt,
    }
  }
}
