# rpc-api — Elysia + oRPC, Postgres, outbox

RPC-only API: no REST routes. The frontend imports **only** `@app/contract` and calls the backend through a typed oRPC client.

```
packages/contract/   zod schemas + oRPC contract + typed errors   ← shared by api & web
apps/api/            the server
apps/web/            frontend client sample (depends on the contract only)
```

## Where things are (apps/api/src)

```
events/
  event.ts             Event entity: business rules + domain events
  event.service.ts     EventService: every event use case (+ read models, repository interface)
  event.repository.ts  PostgresEventRepository: the only class that knows the events table
  event.rpc.ts         EventRpc: contract procedures → EventService
deals/                 same four files; Money value object; name unique per event
tickets/               same four files
shared/domain.ts       AggregateRoot, DomainEvent, errors
shared/ports.ts        interfaces services depend on (Transaction, OutboxWriter, Page…)
auth/session.service.ts   session validation (Bearer token or `sid` cookie)
outbox/outbox.ts       outbox writer, relay, queue publisher
rpc/rpc.ts             `rpc.pub` / `rpc.authed` procedure builders, error mapping
schema.ts              Drizzle tables
database.ts            connection pool + transactions
app.ts                 API process: wires everything, serves /rpc
worker.ts              outbox relay process
```

A request flows `event.rpc.ts → EventService → Event (rules) → PostgresEventRepository`. Only `*.rpc.ts` knows oRPC, and only `*.repository.ts` knows SQL.

## The few rules

**1. Writes go through the entity; reads don't.**
- A command loads the *full* entity, calls a method (where the rule lives), then saves it.
- A query returns a *read model*: a plain type that selects only the columns the screen needs.
- Need fewer fields somewhere? Add a read model and a repository method. Don't make a partial entity.

```ts
// command                                      // query
const event = await this.load(id)               list(page) {
event.update(changes)  // rules run here          return this.events.listSummaries(page)
await this.events.update(event)                 }  // SELECT id, title, venue, starts_at, ends_at
```

**2. The DB row is not the entity.** The repository maps between them: `starts_at` + `ends_at` become one `EventSchedule`, which can't be invalid.

**3. Transactions are ambient.** Every repository call inside `this.tx.run(() => …)` joins the same Postgres transaction, so there's nothing to pass around. The entity change and its outbox row commit together, or not at all.

**4. Entities record events, services publish them.**
- Entity methods call `this.record('event.updated', payload)`.
- The service writes `event.pullEvents()` to the outbox in the same transaction.
- The payload is an explicit, versioned queue message, not the entity. Ticket messages carry no holder PII.

## Add a feature (e.g. "cancel an event")

1. **Contract:** add `cancel: base.input(IdInput).output(EventSchema)` to `eventsContract`.
2. **Rule:** add `cancel()` to `Event`. It checks the rule, changes state, and calls `this.record('event.cancelled', …)`.
3. **Use case:** add `cancel(id, actor)` to `EventService`, following the shape of `update`.
4. **Wire it:** add one line in `EventRpc.routes()`. tsc fails until the contract and router match.

## Sessions

`rpc.pub` resolves the session on every call. A missing or invalid token makes the call anonymous; it doesn't fail. `rpc.authed` requires a session and types `context.session` as non-null. Tokens are stored as sha256 only. This API validates sessions; logging in is your auth service's job.

| procedure | auth |
|---|---|
| `events.list`, `events.get`, `deals.listByEvent`, `deals.get` | public |
| `events.create/update/delete`, `deals.create/update/delete`, all `tickets.*` | session |

Typed errors: `UNAUTHORIZED` (401), `NOT_FOUND {resource,id}` (404), `BUSINESS_RULE_VIOLATION {rule}` (422).

## Outbox

`worker.ts` publishes pending rows in insertion order.
- Several workers can run side by side safely (`FOR UPDATE SKIP LOCKED`).
- Failed rows retry with exponential backoff, then park after `OUTBOX_MAX_ATTEMPTS` attempts.
- Delivery is at-least-once: consumers should dedupe on message `id`.
- To wire a real queue, swap `LoggingMessagePublisher` in `worker.ts`.

## Run

```bash
docker compose up -d        # Postgres, with `app` and `app_test` databases
bun install
cd apps/api
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/app
bun db:migrate
bun dev:session             # prints a dev token + a sample event with 2 tickets
bun dev                     # API on :3000/rpc
bun worker                  # outbox relay
bun test                    # entity tests + API tests on app_test (tables are truncated)
```
