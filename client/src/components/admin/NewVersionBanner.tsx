import { useQuery } from '@tanstack/react-query'
import { fetchDeployedBuildId, isOutdated } from '../../lib/buildVersion'

const CHECK_INTERVAL_MS = 5 * 60_000

/**
 * Tells a person working in the admin that a newer version is deployed, so a tab left open across a
 * deploy does not keep showing old screens. Checks on window focus and every five minutes.
 */
export function NewVersionBanner() {
  const deployed = useQuery({
    queryKey: ['deployed-build-id'],
    queryFn: fetchDeployedBuildId,
    refetchInterval: CHECK_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 60_000,
  })
  if (!isOutdated(deployed.data ?? null)) return null

  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-yellow-200 bg-yellow-50 px-4 py-2 text-sm text-yellow-900">
      <span>A new version of the admin is available. Reload to use it.</span>
      <button
        onClick={() => window.location.reload()}
        className="rounded-md bg-yellow-100 px-3 py-1 font-medium text-yellow-900 hover:bg-yellow-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        Reload
      </button>
    </div>
  )
}
