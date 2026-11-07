import { AsyncLocalStorage } from 'node:async_hooks'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema'
import type { Transaction } from './shared/ports'

type Db = PostgresJsDatabase<typeof schema>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Connection pool + ambient transactions.
 *
 * Repositories always query through `database.db`. Inside `run()` that is the
 * current transaction, outside it is the pool, so services just write
 * `this.tx.run(async () => { … })` and every repository call inside joins the
 * same transaction. No passing transaction objects around.
 */
export class Database implements Transaction {
  private readonly client: postgres.Sql
  private readonly root: Db
  private readonly currentTx = new AsyncLocalStorage<Tx>()

  constructor(url: string, options: { maxConnections?: number } = {}) {
    this.client = postgres(url, { max: options.maxConnections ?? 10 })
    this.root = drizzle({ client: this.client, schema, casing: 'snake_case' })
  }

  get db(): Db | Tx {
    return this.currentTx.getStore() ?? this.root
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.currentTx.getStore()) return work() // already inside a transaction: join it
    return this.root.transaction((tx) => this.currentTx.run(tx, work))
  }

  async migrate(migrationsFolder: string): Promise<void> {
    await migrate(this.root, { migrationsFolder })
  }

  async close(): Promise<void> {
    await this.client.end()
  }
}
