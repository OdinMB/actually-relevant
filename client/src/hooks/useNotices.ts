import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, type AdminNoticeSource } from '../lib/admin-api'

export const NOTICE_PAGE_SIZE = 25

export function useNotices(params: { source?: AdminNoticeSource; show: 'unseen' | 'all'; page: number; limit?: number }) {
  const limit = params.limit ?? NOTICE_PAGE_SIZE
  return useQuery({
    queryKey: ['admin', 'notices', { ...params, limit }],
    queryFn: () => adminApi.notices.list({ ...params, limit }),
  })
}

/** The sidebar badge: unseen notices and how many are critical, polled like the feedback count. */
export function useNoticeCount() {
  return useQuery({
    queryKey: ['noticeCount'],
    queryFn: () => adminApi.notices.count(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

function useInvalidateNotices() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'notices'] })
    queryClient.invalidateQueries({ queryKey: ['noticeCount'] })
  }
}

export function useMarkNoticeSeen() {
  const invalidate = useInvalidateNotices()
  return useMutation({
    mutationFn: (id: string) => adminApi.notices.markSeen(id),
    onSuccess: invalidate,
  })
}

/** Mark every unseen notice seen, or those of one source. */
export function useMarkNoticesSeen() {
  const invalidate = useInvalidateNotices()
  return useMutation({
    mutationFn: (source?: AdminNoticeSource) => adminApi.notices.markAllSeen(source),
    onSuccess: invalidate,
  })
}
