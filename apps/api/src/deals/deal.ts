import { AggregateRoot, BusinessRuleViolation } from '../shared/domain'

/** Value object: an amount in minor units (cents) and its currency. Stored as two columns. */
export class Money {
  private constructor(
    readonly amount: number,
    readonly currency: string,
  ) {}

  static of(amount: number, currency: string): Money {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new BusinessRuleViolation('money.amount_invalid', 'Amount must be a whole, non-negative number of cents')
    }
    const code = currency.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new BusinessRuleViolation('money.currency_invalid', 'Currency must be an ISO 4217 code, e.g. EUR')
    }
    return new Money(amount, code)
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency
  }

  toPlain(): { amount: number; currency: string } {
    return { amount: this.amount, currency: this.currency }
  }
}

/**
 * Thrown when another deal of the same event already uses this name (case-insensitive).
 * Uniqueness spans several deals, so the service checks it, not the entity.
 */
export class DealNameTaken extends BusinessRuleViolation {
  constructor(name: string) {
    super('deal.name_taken', `A deal named "${name}" already exists for this event`)
  }
}

export interface NewDeal {
  eventId: string
  name: string
  description?: string | null
  price: { amount: number; currency: string }
  quantity: number
}

/** A deal never moves to another event. */
export type DealChanges = Partial<Omit<NewDeal, 'eventId'>>

export interface DealState {
  eventId: string
  name: string
  description: string | null
  price: Money
  quantity: number
  createdAt: Date
  updatedAt: Date
}

/** The Deal entity: a priced way to buy tickets for an event (early bird, VIP…). */
export class Deal extends AggregateRoot {
  protected readonly aggregateType = 'deal'

  private constructor(
    readonly id: string,
    private state: DealState,
  ) {
    super()
  }

  static create(input: NewDeal): Deal {
    const now = new Date()
    const deal = new Deal(crypto.randomUUID(), {
      eventId: input.eventId,
      name: Deal.requiredName(input.name),
      description: input.description ?? null,
      price: Money.of(input.price.amount, input.price.currency),
      quantity: Deal.validQuantity(input.quantity),
      createdAt: now,
      updatedAt: now,
    })
    deal.record('deal.created', deal.toPayload())
    return deal
  }

  /** Rebuilds an existing deal from storage. Records nothing. */
  static restore(id: string, state: DealState): Deal {
    return new Deal(id, { ...state })
  }

  get eventId(): string {
    return this.state.eventId
  }
  get name(): string {
    return this.state.name
  }
  get description(): string | null {
    return this.state.description
  }
  get price(): Money {
    return this.state.price
  }
  get quantity(): number {
    return this.state.quantity
  }
  get createdAt(): Date {
    return this.state.createdAt
  }
  get updatedAt(): Date {
    return this.state.updatedAt
  }

  /** Records `deal.updated` only if something actually changed. */
  update(changes: DealChanges): void {
    const next = { ...this.state }
    const changed: string[] = []

    if (changes.name !== undefined) {
      const name = Deal.requiredName(changes.name)
      if (name !== next.name) {
        next.name = name
        changed.push('name')
      }
    }
    if (changes.description !== undefined && changes.description !== next.description) {
      next.description = changes.description
      changed.push('description')
    }
    if (changes.price !== undefined) {
      const price = Money.of(changes.price.amount, changes.price.currency)
      if (!price.equals(next.price)) {
        next.price = price
        changed.push('price')
      }
    }
    if (changes.quantity !== undefined) {
      const quantity = Deal.validQuantity(changes.quantity)
      if (quantity !== next.quantity) {
        next.quantity = quantity
        changed.push('quantity')
      }
    }

    if (changed.length === 0) return
    this.state = { ...next, updatedAt: new Date() }
    this.record('deal.updated', { ...this.toPayload(), changed })
  }

  delete(): void {
    this.record('deal.deleted', { dealId: this.id, eventId: this.state.eventId })
  }

  /** v1 queue payload: explicit fields, price in cents. */
  private toPayload() {
    return {
      dealId: this.id,
      eventId: this.state.eventId,
      name: this.state.name,
      description: this.state.description,
      price: this.state.price.toPlain(),
      quantity: this.state.quantity,
    }
  }

  private static requiredName(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) throw new BusinessRuleViolation('deal.name_required', 'Deal name is required')
    return trimmed
  }

  private static validQuantity(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new BusinessRuleViolation('deal.quantity_invalid', 'Quantity must be a whole number of at least 1')
    }
    return value
  }
}
