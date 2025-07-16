import { pgTable, uuid, timestamp, text } from 'drizzle-orm/pg-core';
import { people } from './people';

export const milestones = pgTable('Milestones', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  day: text('day'),
  label: text('label'),
  month: text('month'),
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  year: text('year'),
});