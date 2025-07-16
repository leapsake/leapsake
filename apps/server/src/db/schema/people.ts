import { pgTable, uuid, timestamp, text } from 'drizzle-orm/pg-core';

export const people = pgTable('People', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  familyName: text('family_name'),
  givenName: text('given_name'),
  maidenName: text('maiden_name'),
  middleName: text('middle_name'),
});