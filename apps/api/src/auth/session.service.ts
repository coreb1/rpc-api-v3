import { createHash } from 'node:crypto'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Database } from '../database'
import { sessions } from '../schema'

export interface Session {
  sessionId: string
  userId: string
}

/**
 * Validates sessions; it does not log users in (that's your auth service).
 * Accepts a Bearer token (mobile / server) or the httpOnly `sid` cookie (browser).
 */
export class SessionService {
  static readonly COOKIE_NAME = 'sid'

  constructor(private readonly database: Database) {}

  /** Never throws: a missing, unknown, expired or revoked token gives `null` (anonymous). */
  async resolve(headers: Headers): Promise<Session | null> {
    const token = this.extractToken(headers)
    if (!token) return null

    const [session] = await this.database.db
      .select({ sessionId: sessions.id, userId: sessions.userId })
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, SessionService.hashToken(token)),
          gt(sessions.expiresAt, new Date()),
          isNull(sessions.revokedAt),
        ),
      )
      .limit(1)
    return session ?? null
  }

  /** Sessions are stored by hash only; the raw token never reaches the database. */
  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private extractToken(headers: Headers): string | null {
    const authorization = headers.get('authorization')
    if (authorization?.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim() || null

    for (const part of headers.get('cookie')?.split(';') ?? []) {
      const [name, ...value] = part.trim().split('=')
      if (name === SessionService.COOKIE_NAME) return decodeURIComponent(value.join('=')) || null
    }
    return null
  }
}
