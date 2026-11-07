/**
 * Dev helper: creates a user + session (and a sample event with tickets)
 * and prints the raw token to use as `Authorization: Bearer <token>`.
 * Real login lives in your auth service; this API only *validates* sessions.
 */
import { randomBytes } from 'node:crypto'
import { SessionService } from '../src/auth/session.service'
import { Database } from '../src/database'
import { events, sessions, tickets, users } from '../src/schema'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')
const database = new Database(url, { maxConnections: 1 })
const db = database.db

const email = process.argv[2] ?? 'dev@example.com'
const [user] = await db
  .insert(users)
  .values({ email })
  .onConflictDoUpdate({ target: users.email, set: { email } })
  .returning()

const token = randomBytes(32).toString('base64url')
await db.insert(sessions).values({
  userId: user!.id,
  tokenHash: SessionService.hashToken(token),
  expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
})

const now = new Date()
const eventId = crypto.randomUUID()
await db.insert(events).values({
  id: eventId,
  title: 'Sample event',
  venue: 'La Machine du Moulin Rouge',
  startsAt: new Date(now.getTime() + 86_400_000),
  endsAt: new Date(now.getTime() + 86_400_000 + 4 * 3_600_000),
  createdAt: now,
  updatedAt: now,
})
await db.insert(tickets).values(
  ['Alice', 'Bob'].map((name) => ({
    id: crypto.randomUUID(),
    eventId,
    holderName: name,
    holderEmail: `${name.toLowerCase()}@example.com`,
    createdAt: now,
    updatedAt: now,
  })),
)

console.log(JSON.stringify({ token, userId: user!.id, sampleEventId: eventId }, null, 2))
await database.close()
