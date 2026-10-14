import { timestamp, uuid, text } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/** PK uuid v7 generada en la aplicación (ordenable por tiempo). */
export const pk = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** Solo fecha de creación (tablas append-only: no hay updated_at). */
export const createdOnly = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};

/** Id de usuario de Entra (oid) que crea el registro. */
export const createdBy = () => text();

export { uuidv7 };
