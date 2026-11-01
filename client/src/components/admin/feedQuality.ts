/** The extraction method behind most of a feed's live stories (`FeedQualityMetrics.extractionMethods`), or null when none has one. */
export function dominantMethod(methods: Record<string, number> | undefined): string | null {
  const ranked = Object.entries(methods ?? {}).sort((a, b) => b[1] - a[1])
  return ranked[0]?.[0] ?? null
}
