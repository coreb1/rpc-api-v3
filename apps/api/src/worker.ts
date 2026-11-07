import { ConfigSchema, type Config } from './config'
import { Database } from './database'
import { LoggingMessagePublisher, OutboxRelay } from './outbox/outbox'

/** The outbox relay process. Separate from the API so it scales independently (N replicas are safe). */
export class OutboxWorker {
  private readonly database: Database
  private readonly relay: OutboxRelay

  constructor(config: Config) {
    this.database = new Database(config.DATABASE_URL, { maxConnections: 2 })
    // Swap LoggingMessagePublisher for your real queue publisher here.
    this.relay = new OutboxRelay(this.database, new LoggingMessagePublisher(), {
      batchSize: config.OUTBOX_BATCH_SIZE,
      pollIntervalMs: config.OUTBOX_POLL_MS,
      maxAttempts: config.OUTBOX_MAX_ATTEMPTS,
    })
  }

  start(): void {
    this.relay.start()
    console.info('[outbox] relay started')
  }

  async stop(): Promise<void> {
    this.relay.stop()
    await this.database.close()
  }
}

if (import.meta.main) {
  const worker = new OutboxWorker(ConfigSchema.parse(process.env))
  worker.start()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void worker.stop().then(() => process.exit(0)))
  }
}
