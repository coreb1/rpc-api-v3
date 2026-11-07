import { z } from 'zod'
import { base, IdInput, PageFields, paginated } from './common'

export const TicketStatus = z.enum(['valid', 'scanned', 'cancelled'])

export const TicketSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  holderName: z.string(),
  holderEmail: z.email(),
  seat: z.string().nullable(),
  status: TicketStatus,
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type TicketDto = z.infer<typeof TicketSchema>

/** List rows: no holder email (lighter payload, less PII on list screens). */
export const TicketListItemSchema = TicketSchema.pick({
  id: true,
  holderName: true,
  seat: true,
  status: true,
})
export type TicketListItemDto = z.infer<typeof TicketListItemSchema>

export const ListTicketsByEventInput = z.object({ eventId: z.uuid(), ...PageFields })

export const UpdateTicketInput = z.object({
  id: z.uuid(),
  patch: z
    .object({
      holderName: z.string().trim().min(1).max(200),
      holderEmail: z.email(),
      seat: z.string().max(50).nullable(),
      status: TicketStatus,
    })
    .partial()
    .refine((p) => Object.keys(p).length > 0, 'patch must not be empty'),
})

export type UpdateTicketInputDto = z.infer<typeof UpdateTicketInput>

export const ticketsContract = {
  listByEvent: base.input(ListTicketsByEventInput).output(paginated(TicketListItemSchema)),
  get: base.input(IdInput).output(TicketSchema),
  update: base.input(UpdateTicketInput).output(TicketSchema),
  delete: base.input(IdInput).output(IdInput),
}
