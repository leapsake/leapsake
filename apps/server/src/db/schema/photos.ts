import { pgTable, uuid, timestamp, text } from 'drizzle-orm/pg-core';

export const photos = pgTable('Photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  alt: text('alt'),
  description: text('description'),
  path: text('path'),
});