import { z } from 'zod'
import { base, IdInput, PageInput, paginated } from './common'

export const EventSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  venue: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
})
export type EventDto = z.infer<typeof EventSchema>

/** Lighter shape for list screens. */
export const EventSummarySchema = EventSchema.pick({
  id: true,
  title: true,
  venue: true,
  startsAt: true,
  endsAt: true,
})
export type EventSummaryDto = z.infer<typeof EventSummarySchema>

export const EventFields = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  venue: z.string().trim().min(1).max(200),
  startsAt: z.date(),
  endsAt: z.date(),
})

export const CreateEventInput = EventFields
export const UpdateEventInput = z.object({
  id: z.uuid(),
  patch: EventFields.partial().refine((p) => Object.keys(p).length > 0, 'patch must not be empty'),
})

export type CreateEventInputDto = z.infer<typeof CreateEventInput>
export type UpdateEventInputDto = z.infer<typeof UpdateEventInput>

export const eventsContract = {
  list: base.input(PageInput).output(paginated(EventSummarySchema)),
  get: base.input(IdInput).output(EventSchema),
  create: base.input(CreateEventInput).output(EventSchema),
  update: base.input(UpdateEventInput).output(EventSchema),
  delete: base.input(IdInput).output(IdInput),
}
