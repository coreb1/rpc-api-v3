import type { DomainEvent } from './domain'

/**
 * Interfaces the services depend on. The Postgres classes implement them;
 * services never import Drizzle directly.
 */

export interface Actor {
  userId: string
}

export interface Page {
  limit: number
  offset: number
}

export interface PageResult<T> {
  items: T[]
  total: number
}

export interface FindOptions {
  /** SELECT … FOR UPDATE, so concurrent commands on the same row wait their turn. */
  forUpdate?: boolean
}

/** Everything inside `run()` shares one database transaction. */
export interface Transaction {
  run<T>(work: () => Promise<T>): Promise<T>
}

export interface OutboxWriter {
  append(events: readonly DomainEvent[], actor: Actor | null): Promise<void>
}
