import { AggregateRoot, BusinessRuleViolation } from '../shared/domain'

/** Value object: a start/end pair that is always valid. Stored as two columns. */
export class EventSchedule {
  private constructor(
    readonly startsAt: Date,
    readonly endsAt: Date,
  ) {}

  static of(startsAt: Date, endsAt: Date): EventSchedule {
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BusinessRuleViolation('event.schedule_invalid', 'Event dates are invalid')
    }
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BusinessRuleViolation('event.ends_after_start', 'Event must end after it starts')
    }
    return new EventSchedule(new Date(startsAt), new Date(endsAt))
  }

  with(changes: { startsAt?: Date; endsAt?: Date }): EventSchedule {
    return EventSchedule.of(changes.startsAt ?? this.startsAt, changes.endsAt ?? this.endsAt)
  }
}

export interface NewEvent {
  title: string
  description?: string | null
  venue: string
  startsAt: Date
  endsAt: Date
}

export type EventChanges = Partial<NewEvent>

export interface EventState {
  title: string
  description: string | null
  venue: string
  schedule: EventSchedule
  createdAt: Date
  updatedAt: Date
}

/**
 * The Event entity: business rules live here and nowhere else.
 * State is private and changes only through methods, each of which records a
 * domain event for the outbox.
 */
export class Event extends AggregateRoot {
  protected readonly aggregateType = 'event'

  private constructor(
    readonly id: string,
    private state: EventState,
  ) {
    super()
  }

  static create(input: NewEvent): Event {
    const now = new Date()
    const event = new Event(crypto.randomUUID(), {
      title: Event.required(input.title, 'title'),
      description: input.description ?? null,
      venue: Event.required(input.venue, 'venue'),
      schedule: EventSchedule.of(input.startsAt, input.endsAt),
      createdAt: now,
      updatedAt: now,
    })
    event.record('event.created', event.toPayload())
    return event
  }

  /** Rebuilds an existing event from storage. Records nothing. */
  static restore(id: string, state: EventState): Event {
    return new Event(id, { ...state })
  }

  get title(): string {
    return this.state.title
  }
  get description(): string | null {
    return this.state.description
  }
  get venue(): string {
    return this.state.venue
  }
  get schedule(): EventSchedule {
    return this.state.schedule
  }
  get createdAt(): Date {
    return this.state.createdAt
  }
  get updatedAt(): Date {
    return this.state.updatedAt
  }

  /** Records `event.updated` only if something actually changed. */
  update(changes: EventChanges): void {
    const next = { ...this.state }
    const changed: string[] = []

    if (changes.title !== undefined) {
      const title = Event.required(changes.title, 'title')
      if (title !== next.title) {
        next.title = title
        changed.push('title')
      }
    }
    if (changes.description !== undefined && changes.description !== next.description) {
      next.description = changes.description
      changed.push('description')
    }
    if (changes.venue !== undefined) {
      const venue = Event.required(changes.venue, 'venue')
      if (venue !== next.venue) {
        next.venue = venue
        changed.push('venue')
      }
    }
    if (changes.startsAt !== undefined || changes.endsAt !== undefined) {
      const schedule = next.schedule.with(changes)
      if (schedule.startsAt.getTime() !== next.schedule.startsAt.getTime()) changed.push('startsAt')
      if (schedule.endsAt.getTime() !== next.schedule.endsAt.getTime()) changed.push('endsAt')
      next.schedule = schedule
    }

    if (changed.length === 0) return
    this.state = { ...next, updatedAt: new Date() }
    this.record('event.updated', { ...this.toPayload(), changed })
  }

  delete(): void {
    this.record('event.deleted', { eventId: this.id })
  }

  /** v1 queue payload: explicit fields, ISO dates. */
  private toPayload() {
    return {
      eventId: this.id,
      title: this.state.title,
      description: this.state.description,
      venue: this.state.venue,
      startsAt: this.state.schedule.startsAt.toISOString(),
      endsAt: this.state.schedule.endsAt.toISOString(),
    }
  }

  private static required(value: string, field: string): string {
    const trimmed = value.trim()
    if (!trimmed) throw new BusinessRuleViolation(`event.${field}_required`, `Event ${field} is required`)
    return trimmed
  }
}
