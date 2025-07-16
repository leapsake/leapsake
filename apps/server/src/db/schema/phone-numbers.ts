import { pgTable, uuid, timestamp, text } from 'drizzle-orm/pg-core';
import { people } from './people';

export const phoneNumbers = pgTable('PhoneNumbers', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  label: text('label'),
  number: text('number'),
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
});