import { AggregateRoot, BusinessRuleViolation } from '../shared/domain'

export type TicketStatus = 'valid' | 'scanned' | 'cancelled'

export interface TicketChanges {
  holderName?: string
  holderEmail?: string
  seat?: string | null
  status?: TicketStatus
}

export interface TicketState {
  eventId: string
  holderName: string
  holderEmail: string
  seat: string | null
  status: TicketStatus
  createdAt: Date
  updatedAt: Date
}

/** The Ticket entity: status lifecycle and holder rules live here. */
export class Ticket extends AggregateRoot {
  protected readonly aggregateType = 'ticket'

  /** valid → scanned | cancelled, and no way back. */
  private static readonly TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
    valid: ['scanned', 'cancelled'],
    scanned: [],
    cancelled: [],
  }

  private constructor(
    readonly id: string,
    private state: TicketState,
  ) {
    super()
  }

  /** Rebuilds an existing ticket from storage. Records nothing. */
  static restore(id: string, state: TicketState): Ticket {
    return new Ticket(id, { ...state })
  }

  get eventId(): string {
    return this.state.eventId
  }
  get holderName(): string {
    return this.state.holderName
  }
  get holderEmail(): string {
    return this.state.holderEmail
  }
  get seat(): string | null {
    return this.state.seat
  }
  get status(): TicketStatus {
    return this.state.status
  }
  get createdAt(): Date {
    return this.state.createdAt
  }
  get updatedAt(): Date {
    return this.state.updatedAt
  }

  /** Records `ticket.updated` only if something actually changed. */
  update(changes: TicketChanges): void {
    const next = { ...this.state }
    const changed: string[] = []

    const holderName = changes.holderName?.trim()
    const holderEmail = changes.holderEmail?.trim().toLowerCase()
    if (holderName === '') {
      throw new BusinessRuleViolation('ticket.holder_name_required', 'Holder name is required')
    }
    const holderChanges =
      (holderName !== undefined && holderName !== next.holderName) ||
      (holderEmail !== undefined && holderEmail !== next.holderEmail)
    if (holderChanges) {
      // Checked against the status *before* this update.
      if (this.state.status !== 'valid') {
        throw new BusinessRuleViolation('ticket.holder_locked', 'Holder can only change while the ticket is valid')
      }
      if (holderName !== undefined && holderName !== next.holderName) {
        next.holderName = holderName
        changed.push('holderName')
      }
      if (holderEmail !== undefined && holderEmail !== next.holderEmail) {
        next.holderEmail = holderEmail
        changed.push('holderEmail')
      }
    }

    if (changes.seat !== undefined && changes.seat !== next.seat) {
      next.seat = changes.seat
      changed.push('seat')
    }

    if (changes.status !== undefined && changes.status !== next.status) {
      if (!Ticket.TRANSITIONS[next.status].includes(changes.status)) {
        throw new BusinessRuleViolation(
          'ticket.status_transition',
          `Cannot move ticket from ${next.status} to ${changes.status}`,
        )
      }
      next.status = changes.status
      changed.push('status')
    }

    if (changed.length === 0) return
    this.state = { ...next, updatedAt: new Date() }
    // v1 queue payload: ids and state only, no holder PII (consumers fetch it if they need it).
    this.record('ticket.updated', {
      ticketId: this.id,
      eventId: this.state.eventId,
      seat: this.state.seat,
      status: this.state.status,
      changed,
    })
  }

  delete(): void {
    this.record('ticket.deleted', { ticketId: this.id, eventId: this.state.eventId })
  }
}
