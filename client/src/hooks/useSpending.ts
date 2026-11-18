import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { SpendScope } from '@shared/types'
import { adminApi } from '../lib/admin-api'

/** The Dashboard's spending overview: this month per job, with the two months before. */
export function useSpending() {
  return useQuery({
    queryKey: ['spending'],
    queryFn: () => adminApi.spending.overview(),
  })
}

/** Set a scope's monthly warning level in whole dollars, or clear it with null; the overview reloads. */
export function useSetSpendLevel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ scope, levelUsd }: { scope: SpendScope; levelUsd: number | null }) => adminApi.spending.setLevel(scope, levelUsd),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['spending'] }),
  })
}
