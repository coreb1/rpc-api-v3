/** Domain building blocks. No database, no HTTP, no oRPC in here. */

export class DomainError extends Error {}

export class NotFoundError extends DomainError {
  constructor(
    readonly resource: string,
    readonly id: string,
  ) {
    super(`${resource} ${id} not found`)
  }
}

export class BusinessRuleViolation extends DomainError {
  constructor(
    readonly rule: string,
    message: string,
  ) {
    super(message)
  }
}

/**
 * A fact that happened, written to the outbox in the same transaction as the change.
 * `payload` is the shape queue consumers will see: built explicitly by the
 * entity, not a dump of the entity. Bump `version` when it changes.
 */
export class DomainEvent<TPayload extends object = object> {
  constructor(
    readonly type: string,
    readonly aggregateType: string,
    readonly aggregateId: string,
    readonly payload: TPayload,
    readonly occurredAt: Date = new Date(),
    readonly version: number = 1,
  ) {}
}

/** Base class for entities that emit domain events. */
export abstract class AggregateRoot {
  abstract readonly id: string
  protected abstract readonly aggregateType: string
  private pendingEvents: DomainEvent[] = []

  protected record(type: string, payload: object): void {
    this.pendingEvents.push(new DomainEvent(type, this.aggregateType, this.id, payload))
  }

  /** Returns the events recorded since the last call, and clears them. */
  pullEvents(): DomainEvent[] {
    const events = this.pendingEvents
    this.pendingEvents = []
    return events
  }
}
