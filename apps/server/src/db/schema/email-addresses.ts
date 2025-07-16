import { pgTable, uuid, timestamp, text, index } from 'drizzle-orm/pg-core';
import { people } from './people';

export const emailAddresses = pgTable('EmailAddresses', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  address: text('address'),
  label: text('label'),
  personId: uuid('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, (table) => ({
  personIdIdx: index('idx_emailaddress_person_id').on(table.personId),
}));