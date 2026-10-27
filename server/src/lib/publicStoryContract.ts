/**
 * Type-level check, run by `npm run typecheck` (.context/ci.md, "Public API contract"): the story the
 * public routes serve (PUBLIC_STORY_SELECT, plus the `aiGenerated` marker the routes add) and the
 * story the OpenAPI document promises (publicStorySchema) have the same fields, both ways and at
 * every depth, and every value the database can serve is one the document allows: a nullable column
 * is documented as nullable, an enum's values are documented, a date is a string. The two lists are
 * kept by hand; a gap between them fails the type-check with an error that names it (tsc shows the
 * first), such as
 *
 *   Type '"feed.url: served, not documented"' is not assignable to type 'never'.
 *   Type '"feed.displayTitle: served as null, documented as never null"' does not satisfy the constraint 'never'.
 *
 * Fix it by documenting the field in openapi.ts (with the snapshot refresh that follows), or by
 * changing the select. The file holds types only and compiles to nothing.
 */
import type { Prisma } from '@prisma/client'
import type { z } from 'zod'
import type { PUBLIC_STORY_SELECT } from '../services/storySelect.js'
import type { withAiGeneratedMarker } from './aiProvenance.js'
import type { publicStorySchema } from './openapi.js'

/** A value as JSON carries it: a Date becomes its ISO string. */
type AsJson<T> = T extends Date ? string : T extends readonly (infer Item)[] ? AsJson<Item>[] : T extends object ? { [K in keyof T]: AsJson<T[K]> } : T

type IsRecord<T> = T extends Date ? false : T extends readonly unknown[] ? false : T extends object ? true : false

/** Every way `Served` and `Documented` disagree, as text naming the field; `never` when they agree. */
export type ContractGaps<Served, Documented, Path extends string = ''> =
  | `${Path}${Exclude<keyof Served, keyof Documented> & string}: served, not documented`
  | `${Path}${Exclude<keyof Documented, keyof Served> & string}: documented, not served`
  | { [K in keyof Served & keyof Documented & string]: FieldGaps<Served[K], Documented[K], `${Path}${K}`> }[keyof Served & keyof Documented & string]

type NullGap<Served, Documented, Path extends string> = null extends Served
  ? null extends Documented
    ? never
    : `${Path}: served as null, documented as never null`
  : never

type FieldGaps<Served, Documented, Path extends string> = [IsRecord<NonNullable<Served>>, IsRecord<NonNullable<Documented>>] extends [true, true]
  ? NullGap<Served, Documented, Path> | ContractGaps<NonNullable<Served>, NonNullable<Documented>, `${Path}.`>
  : [NullGap<Served, Documented, Path>] extends [never]
    ? [AsJson<Served>] extends [Documented]
      ? never
      : `${Path}: serves values the document does not allow`
    : NullGap<Served, Documented, Path>

/** Compiles only when `Gaps` is `never`; otherwise the error message lists each gap. */
type NoGaps<Gaps extends never> = Gaps

type PublicStoryRow = Prisma.StoryGetPayload<{ select: typeof PUBLIC_STORY_SELECT }>
/** Every public story read filters on `status: 'published'` (services/publicStories.ts, relatedStories.ts, storySearch.ts). */
type ServedStory = ReturnType<typeof withAiGeneratedMarker<Omit<PublicStoryRow, 'status'> & { status: 'published' }>>
type DocumentedStory = z.infer<typeof publicStorySchema>

export type PublicStoryContract = NoGaps<ContractGaps<ServedStory, DocumentedStory>>

// ──── The check's own tests: each line below must fail to compile, or the type-check fails ────

type Sample = { id: string; date: Date | null; tone: 'calm' | 'scary'; feed: { title: string; issue: { slug: string } | null } }
type SampleJson = AsJson<Sample>

export type _AgreesWithItsJson = NoGaps<ContractGaps<Sample, SampleJson>>
// @ts-expect-error a served field the document leaves out
export type _ServedNotDocumented = NoGaps<ContractGaps<Sample & { extra: string }, SampleJson>>
// @ts-expect-error a nested field the document promises but the select leaves out
export type _DocumentedNotServed = NoGaps<ContractGaps<Sample, SampleJson & { feed: { url: string } }>>
// @ts-expect-error a nested object served as null but documented as never null
export type _NullObject = NoGaps<ContractGaps<Sample, Omit<SampleJson, 'feed'> & { feed: { title: string; issue: { slug: string } } }>>
// @ts-expect-error a value served as null but documented as never null
export type _NullValue = NoGaps<ContractGaps<Sample, Omit<SampleJson, 'date'> & { date: string }>>
// @ts-expect-error an enum value served but not documented
export type _EnumValue = NoGaps<ContractGaps<Sample, Omit<SampleJson, 'tone'> & { tone: 'calm' }>>
// @ts-expect-error a value of another type than documented
export type _OtherType = NoGaps<ContractGaps<Sample, Omit<SampleJson, 'id'> & { id: number }>>
