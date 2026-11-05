/**
 * The four top-level topics' accent colors, as the website draws them (the `hex` values in
 * client/src/lib/category-colors.ts): the dot before a topic's name in the newsletter email and the
 * section preview images. Any other topic, a subtopic included, gets the brand pink.
 */
export const TOPIC_COLORS: Readonly<Record<string, string>> = {
  'human-development': '#fbbf24',
  'planet-climate': '#2dd4bf',
  'existential-threats': '#f87171',
  'science-technology': '#818cf8',
}

export const DEFAULT_TOPIC_COLOR = '#f472b6'

export function topicColor(slug: string): string {
  // An own key only: a slug such as "constructor" must not reach the object's prototype
  return Object.hasOwn(TOPIC_COLORS, slug) ? TOPIC_COLORS[slug]! : DEFAULT_TOPIC_COLOR
}
