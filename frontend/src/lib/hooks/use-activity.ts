import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { activityApi, ActivityCounts, ActivityResponse } from '@/lib/api/activity'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'

/** Poll interval for the activity page while jobs are queued/running. */
export const ACTIVITY_ACTIVE_POLL_MS = 3000
/** Poll interval for the activity page when nothing is in progress. */
export const ACTIVITY_IDLE_POLL_MS = 15000
/** Poll interval for the sidebar badge. */
export const ACTIVITY_SUMMARY_POLL_MS = 5000

/**
 * When the number of active jobs drops, some job finished: refresh the data
 * it may have produced (sources, notes, podcasts) and the activity queries.
 * Invalidation is deliberately broad, like elsewhere in the app.
 */
function useRefreshOnJobFinish(active: number | undefined) {
  const queryClient = useQueryClient()
  const previous = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (active === undefined) return
    const prev = previous.current
    previous.current = active
    if (prev !== undefined && active < prev) {
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
      queryClient.invalidateQueries({ queryKey: ['podcasts'] })
      queryClient.invalidateQueries({ queryKey: ['activity'] })
    }
  }, [active, queryClient])
}

export function useActivity({ hours = 24 }: { hours?: number } = {}) {
  const query = useQuery({
    queryKey: QUERY_KEYS.activity(hours),
    queryFn: () => activityApi.list({ hours }),
    staleTime: 0,
    refetchInterval: (q) => {
      const data = q.state.data as ActivityResponse | undefined
      return data && data.counts.active > 0 ? ACTIVITY_ACTIVE_POLL_MS : ACTIVITY_IDLE_POLL_MS
    },
  })
  useRefreshOnJobFinish(query.data?.counts.active)
  return query
}

export function useActivitySummary() {
  const query = useQuery<ActivityCounts>({
    queryKey: QUERY_KEYS.activitySummary,
    queryFn: () => activityApi.summary(),
    staleTime: 0,
    refetchInterval: ACTIVITY_SUMMARY_POLL_MS,
  })
  useRefreshOnJobFinish(query.data?.active)
  return query
}


function useActivityMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  successMessage: (result: TResult, t: (key: string, opts?: Record<string, unknown>) => string) => string,
  errorKey: string
) {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['activity'] })
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      toast.success(successMessage(result, t))
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, (key) => t(key), errorKey))
    },
  })
}

/** Stop one queued/running job. */
export function useCancelJob() {
  return useActivityMutation(
    (jobId: string) => activityApi.cancelJob(jobId),
    (r, t) => (r.stopping ? t('activity.stopping') : t('activity.canceledToast')),
    'activity.cancelFailed'
  )
}

/** Stop every job of a source/link, optionally deleting the source. */
export function useCancelTarget() {
  return useActivityMutation(
    (data: Parameters<typeof activityApi.cancelTarget>[0]) => activityApi.cancelTarget(data),
    (r, t) =>
      r.deleted_target
        ? t('activity.canceledAndDeletedToast', { count: r.canceled })
        : t('activity.canceledJobsToast', { count: r.canceled }),
    'activity.cancelFailed'
  )
}

export function useDismissJob() {
  return useActivityMutation(
    (jobId: string) => activityApi.dismissJob(jobId),
    (_r, t) => t('activity.dismissedToast'),
    'activity.dismissFailed'
  )
}

export function useDismissFinished() {
  return useActivityMutation(
    (hours: number) => activityApi.dismissFinished(hours),
    (r, t) => t('activity.dismissedAllToast', { count: r.dismissed }),
    'activity.dismissFailed'
  )
}
