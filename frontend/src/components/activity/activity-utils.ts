import type { ActivityJob, ActivityStage, ActivityTargetType } from '@/lib/api/activity'

/** Queued jobs older than this with nothing running suggest the worker is down. */
export const WORKER_STALL_THRESHOLD_MS = 60_000

/** i18n key for each pipeline stage (literal keys keep the unused-key check happy). */
export const STAGE_LABEL_KEYS: Record<ActivityStage, string> = {
  extraction: 'activity.stages.extraction',
  transformation: 'activity.stages.transformation',
  insight: 'activity.stages.insight',
  embedding: 'activity.stages.embedding',
  insight_embedding: 'activity.stages.insight_embedding',
  note_embedding: 'activity.stages.note_embedding',
  cloud_sync: 'activity.stages.cloud_sync',
  podcast: 'activity.stages.podcast',
  rebuild_embeddings: 'activity.stages.rebuild_embeddings',
  other: 'activity.stages.other',
}

export const SYSTEM_GROUP_KEY = 'system'

export interface ActivityGroup {
  /** `${target_type}|${target_id}`, or SYSTEM_GROUP_KEY for jobs without target. */
  key: string
  targetType: ActivityTargetType | null
  targetId: string | null
  title: string | null
  /** False when any job reports the target as deleted. */
  exists: boolean
  jobs: ActivityJob[]
}

export function groupKey(job: ActivityJob): string {
  return job.target_type && job.target_id
    ? `${job.target_type}|${job.target_id}`
    : SYSTEM_GROUP_KEY
}

/**
 * Group jobs by target, keeping the order in which each target first appears
 * (the API already sorts: active oldest-first, recent newest-first) and the
 * relative order of jobs inside a group.
 */
export function groupJobsByTarget(jobs: ActivityJob[]): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>()
  for (const job of jobs) {
    const key = groupKey(job)
    let group = groups.get(key)
    if (!group) {
      const isSystem = key === SYSTEM_GROUP_KEY
      group = {
        key,
        targetType: isSystem ? null : job.target_type,
        targetId: isSystem ? null : job.target_id,
        title: null,
        exists: true,
        jobs: [],
      }
      groups.set(key, group)
    }
    group.jobs.push(job)
    if (!group.title && job.target_title) group.title = job.target_title
    if (!job.target_exists && group.targetId) group.exists = false
  }
  return [...groups.values()]
}

export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

/** Compact duration: "12s", "3m 05s", "1h 02m". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

/**
 * Live elapsed time of an active job: since started_at when running (falling
 * back to created), or the waiting time since created when queued.
 */
export function activeElapsedMs(job: ActivityJob, now: number): number | null {
  const start =
    job.status === 'running'
      ? parseTime(job.started_at) ?? parseTime(job.created)
      : parseTime(job.created)
  return start === null ? null : Math.max(0, now - start)
}

/** Run time of a finished job (finished_at − started_at), when both are known. */
export function finishedDurationMs(job: ActivityJob): number | null {
  const start = parseTime(job.started_at)
  const end = parseTime(job.finished_at)
  return start === null || end === null ? null : Math.max(0, end - start)
}

/**
 * True when jobs are queued but nothing is running and the oldest queued job
 * has been waiting longer than the threshold — likely no worker is running.
 */
export function isWorkerStalled(
  active: ActivityJob[],
  running: number,
  now: number,
  thresholdMs = WORKER_STALL_THRESHOLD_MS,
): boolean {
  if (running > 0) return false
  const queuedTimes = active
    .filter((job) => job.status === 'new')
    .map((job) => parseTime(job.created))
    .filter((ms): ms is number => ms !== null)
  if (queuedTimes.length === 0) return false
  return now - Math.min(...queuedTimes) > thresholdMs
}

export function sourceHref(id: string): string {
  return `/sources/${encodeURIComponent(id)}`
}
