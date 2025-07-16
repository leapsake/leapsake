import { pgTable, uuid, timestamp, text } from 'drizzle-orm/pg-core';
import { photos } from './photos';

export const albums = pgTable('Albums', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  description: text('description'),
});

export const albumItems = pgTable('AlbumItems', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  photoId: uuid('photo_id').notNull().references(() => photos.id, { onDelete: 'cascade' }),
  albumId: uuid('album_id').notNull().references(() => albums.id, { onDelete: 'cascade' }),
});