import { z } from 'zod'

/**
 * `schema` with every object in it strict, at any depth (through nullable, optional, arrays,
 * records and lazy schemas): parsing then fails on a key the schema does not name, where zod's
 * default strips it silently. For checking real responses against the documented schemas, so a
 * served field the document leaves out fails the parse. Unions and effects are left as they are.
 */
export function strictSchema<T extends z.ZodTypeAny>(schema: T): T {
  return deepStrict(schema) as T
}

function deepStrict(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodObject) {
    const shape = Object.fromEntries(Object.entries(schema.shape as z.ZodRawShape).map(([key, value]) => [key, deepStrict(value)]))
    return schema.extend(shape).strict()
  }
  if (schema instanceof z.ZodNullable) return deepStrict(schema.unwrap()).nullable()
  if (schema instanceof z.ZodOptional) return deepStrict(schema.unwrap()).optional()
  if (schema instanceof z.ZodArray) return new z.ZodArray({ ...schema._def, type: deepStrict(schema.element) })
  if (schema instanceof z.ZodRecord) return z.record(schema.keySchema, deepStrict(schema.valueSchema))
  if (schema instanceof z.ZodLazy) return z.lazy(() => deepStrict(schema.schema))
  return schema
}
