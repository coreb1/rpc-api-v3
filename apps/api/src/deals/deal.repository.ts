import { and, asc, eq, ne, sql } from 'drizzle-orm'
import type { Database } from '../database'
import { deals, type DealRow } from '../schema'
import type { FindOptions, Page, PageResult } from '../shared/ports'
import { Deal, DealNameTaken, Money } from './deal'
import type { DealDetails, DealListItem, DealRepository } from './deal.service'

/** The only class that knows how deals are stored. */
export class PostgresDealRepository implements DealRepository {
  private static readonly NAME_UNIQUE_INDEX = 'deals_event_name_uq'

  private static readonly LIST_COLUMNS = {
    id: deals.id,
    name: deals.name,
    price: { amount: deals.priceAmount, currency: deals.priceCurrency },
    quantity: deals.quantity,
  }

  private static readonly DETAIL_COLUMNS = {
    ...PostgresDealRepository.LIST_COLUMNS,
    eventId: deals.eventId,
    description: deals.description,
    createdAt: deals.createdAt,
    updatedAt: deals.updatedAt,
  }

  constructor(private readonly database: Database) {}

  // ---------- writes: full row ↔ entity ----------

  async findById(id: string, options?: FindOptions): Promise<Deal | null> {
    const query = this.database.db.select().from(deals).where(eq(deals.id, id)).limit(1)
    const [row] = options?.forUpdate ? await query.for('update') : await query
    return row ? this.toEntity(row) : null
  }

  async add(deal: Deal): Promise<void> {
    await this.guardName(deal, () => this.database.db.insert(deals).values(this.toRow(deal)))
  }

  async update(deal: Deal): Promise<void> {
    const { id, eventId: _eventId, createdAt: _createdAt, ...changes } = this.toRow(deal)
    await this.guardName(deal, () => this.database.db.update(deals).set(changes).where(eq(deals.id, id)))
  }

  async remove(id: string): Promise<void> {
    await this.database.db.delete(deals).where(eq(deals.id, id))
  }

  async nameTaken(eventId: string, name: string, exceptId?: string): Promise<boolean> {
    const [row] = await this.database.db
      .select({ found: sql<number>`1` })
      .from(deals)
      .where(
        and(
          eq(deals.eventId, eventId),
          // Same expression as the unique index, so the index serves this query.
          sql`lower(${deals.name}) = lower(${name})`,
          exceptId ? ne(deals.id, exceptId) : undefined,
        ),
      )
      .limit(1)
    return row !== undefined
  }

  // ---------- reads: only the columns each read model needs ----------

  async listByEvent(eventId: string, { limit, offset }: Page): Promise<PageResult<DealListItem>> {
    const byEvent = eq(deals.eventId, eventId)
    const [items, total] = await Promise.all([
      this.database.db
        .select(PostgresDealRepository.LIST_COLUMNS)
        .from(deals)
        .where(byEvent)
        .orderBy(asc(deals.createdAt), asc(deals.id))
        .limit(limit)
        .offset(offset),
      this.database.db.$count(deals, byEvent),
    ])
    return { items, total }
  }

  async findDetails(id: string): Promise<DealDetails | null> {
    const [row] = await this.database.db
      .select(PostgresDealRepository.DETAIL_COLUMNS)
      .from(deals)
      .where(eq(deals.id, id))
      .limit(1)
    return row ?? null
  }

  // ---------- unique name: the service checks first, the index settles races ----------

  private async guardName(deal: Deal, write: () => Promise<unknown>): Promise<void> {
    try {
      await write()
    } catch (error) {
      if (PostgresDealRepository.isUniqueViolation(error, PostgresDealRepository.NAME_UNIQUE_INDEX)) {
        throw new DealNameTaken(deal.name)
      }
      throw error
    }
  }

  /** Drizzle wraps driver errors, so look down the `cause` chain for the Postgres one. */
  private static isUniqueViolation(error: unknown, constraint: string): boolean {
    for (let current = error; current instanceof Error; current = current.cause) {
      const pg = current as Error & { code?: string; constraint_name?: string }
      if (pg.code === '23505') return pg.constraint_name === constraint
    }
    return false
  }

  // ---------- mapping: two columns ↔ one Money ----------

  private toEntity(row: DealRow): Deal {
    return Deal.restore(row.id, {
      eventId: row.eventId,
      name: row.name,
      description: row.description,
      price: Money.of(row.priceAmount, row.priceCurrency),
      quantity: row.quantity,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }

  private toRow(deal: Deal): DealRow {
    return {
      id: deal.id,
      eventId: deal.eventId,
      name: deal.name,
      description: deal.description,
      priceAmount: deal.price.amount,
      priceCurrency: deal.price.currency,
      quantity: deal.quantity,
      createdAt: deal.createdAt,
      updatedAt: deal.updatedAt,
    }
  }
}
