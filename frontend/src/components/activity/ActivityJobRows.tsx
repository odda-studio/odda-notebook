'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import {
  ChevronRight,
  Clock,
  FileText,
  FolderSync,
  Info,
  Loader2,
  Mic,
  RotateCcw,
  Square,
  StickyNote,
  Timer,
  X,
  type LucideIcon,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { LlmUsageInline } from '@/components/common/LlmUsageView'
import { Progress } from '@/components/ui/progress'
import type { ActivityJob, ActivityProgress, ActivityTargetType } from '@/lib/api/activity'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'
import {
  activeElapsedMs,
  finishedDurationMs,
  formatDuration,
  parseTime,
  progressPercent,
  sourceHref,
  STAGE_LABEL_KEYS,
  stepLabel,
} from './activity-utils'

export type TFn = ReturnType<typeof useTranslation>['t']

export const TARGET_ICONS: Record<ActivityTargetType, LucideIcon> = {
  source: FileText,
  note: StickyNote,
  link: FolderSync,
  podcast: Mic,
}

export function jobDetail(job: ActivityJob, t: TFn): string | null {
  if (!job.detail) return null
  if (job.stage === 'extraction') {
    const count = Number(job.detail)
    if (!Number.isFinite(count) || count <= 0) return null
    return t('activity.transformationsCount', { count })
  }
  return job.detail
}

/** "Embedding · 120/400 · text-embedding-3-small" with a bar when there is a counter. */
export function ProgressLine({
  progress,
  t,
  now,
}: {
  progress: ActivityProgress
  t: TFn
  now?: number
}) {
  const percent = progressPercent(progress)
  const at = parseTime(progress.at)
  return (
    <div className="w-full space-y-1" data-testid="activity-progress">
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <ChevronRight className="h-3 w-3 shrink-0" />
        <span className="shrink-0 font-medium text-foreground">{stepLabel(progress.step, t)}</span>
        {progress.total !== null && progress.current !== null && (
          <span className="shrink-0 tabular-nums">
            {progress.current}/{progress.total}
          </span>
        )}
        {progress.detail && (
          <span className="truncate" title={progress.detail}>
            · {progress.detail}
          </span>
        )}
        {now !== undefined && at !== null && (
          <span className="ml-auto shrink-0 tabular-nums">
            {t('activity.updatedAgo', { time: formatDuration(now - at) })}
          </span>
        )}
      </div>
      {percent !== null && <Progress value={percent} className="h-1.5" />}
    </div>
  )
}

/** Target of a job, linked when it is an existing source. */
export function TargetLabel({ job, t }: { job: ActivityJob; t: TFn }) {
  if (!job.target_type) return <span className="text-muted-foreground">{t('activity.system')}</span>
  const Icon = TARGET_ICONS[job.target_type]
  const title = job.target_title || t('activity.untitled')
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {job.target_type === 'source' && job.target_exists && job.target_id ? (
        <Link href={sourceHref(job.target_id)} className="truncate hover:underline">
          {title}
        </Link>
      ) : (
        <span className={job.target_exists ? 'truncate' : 'truncate text-muted-foreground line-through'}>
          {title}
        </span>
      )}
    </span>
  )
}

export function ActiveJobRow({
  job,
  now,
  t,
  showTarget,
  selected,
  onSelect,
  onCancel,
  onDetails,
  canceling,
}: {
  job: ActivityJob
  now: number
  t: TFn
  /** "By phase" view: show what the job works on instead of its stage. */
  showTarget: boolean
  selected: boolean
  onSelect: (jobId: string, selected: boolean) => void
  onCancel: (jobId: string) => void
  onDetails: (jobId: string) => void
  canceling: boolean
}) {
  const elapsed = activeElapsedMs(job, now)
  const detail = jobDetail(job, t)
  const running = job.status === 'running'
  const stopping = job.cancel_requested

  return (
    <li className="space-y-1.5 text-sm" data-testid="activity-active-job">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Checkbox
          checked={selected}
          disabled={stopping}
          onCheckedChange={(checked) => onSelect(job.id, checked === true)}
          aria-label={t('activity.selectJob')}
        />
        {running ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        {showTarget ? (
          <span className="min-w-0 max-w-[60%] font-medium">
            <TargetLabel job={job} t={t} />
          </span>
        ) : (
          <span className="font-medium">{t(STAGE_LABEL_KEYS[job.stage])}</span>
        )}
        {detail && <span className="truncate text-muted-foreground">{detail}</span>}
        {stopping ? (
          <Badge variant="outline" className="text-destructive">{t('activity.statusStopping')}</Badge>
        ) : (
          <Badge variant={running ? 'default' : 'secondary'}>
            {running ? t('activity.statusRunning') : t('activity.waitingForWorker')}
          </Badge>
        )}
        {job.attempts > 1 && (
          <Badge variant="outline" className="gap-1">
            <RotateCcw className="h-3 w-3" />
            {t('activity.attempt', { count: job.attempts })}
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-1">
          {elapsed !== null && (
            <span className="mr-1 flex items-center gap-1 tabular-nums text-xs text-muted-foreground">
              <Timer className="h-3 w-3" />
              {formatDuration(elapsed)}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-muted-foreground"
            onClick={() => onDetails(job.id)}
            aria-label={t('activity.details')}
            title={t('activity.details')}
          >
            <Info className="h-3.5 w-3.5" />
          </Button>
          {!stopping && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-muted-foreground hover:text-destructive"
              disabled={canceling}
              onClick={() => onCancel(job.id)}
              aria-label={t('activity.stop')}
              title={t('activity.stop')}
            >
              <Square className="h-3 w-3" />
              {t('activity.stop')}
            </Button>
          )}
        </span>
      </div>
      {job.progress && (
        <div className="pl-12">
          <ProgressLine progress={job.progress} t={t} now={now} />
        </div>
      )}
      {job.llm_usage?.length > 0 && <LlmUsageInline calls={job.llm_usage} className="pl-12" />}
    </li>
  )
}

export function RecentJobRow({
  job,
  t,
  language,
  showTarget,
  onRetry,
  retrying,
  onDismiss,
  onDetails,
}: {
  job: ActivityJob
  t: TFn
  language: string
  showTarget: boolean
  onRetry: (sourceId: string) => void
  retrying: boolean
  onDismiss: (jobId: string) => void
  onDetails: (jobId: string) => void
}) {
  const duration = finishedDurationMs(job)
  const finishedAt = parseTime(job.finished_at)
  const detail = jobDetail(job, t)

  const statusBadge =
    job.status === 'failed' ? (
      <Badge variant="destructive">{t('activity.statusFailed')}</Badge>
    ) : job.status === 'canceled' ? (
      <Badge variant="secondary">{t('activity.statusCanceled')}</Badge>
    ) : (
      <Badge variant="default">{t('activity.statusCompleted')}</Badge>
    )

  return (
    <li className="space-y-1 text-sm" data-testid="activity-recent-job">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {showTarget ? (
          <span className="min-w-0 max-w-[60%] font-medium">
            <TargetLabel job={job} t={t} />
          </span>
        ) : (
          <span className="font-medium">{t(STAGE_LABEL_KEYS[job.stage])}</span>
        )}
        {detail && <span className="truncate text-muted-foreground">{detail}</span>}
        {statusBadge}
        {job.attempts > 1 && (
          <Badge variant="outline" className="gap-1">
            <RotateCcw className="h-3 w-3" />
            {t('activity.attempt', { count: job.attempts })}
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {duration !== null && (
            <span className="flex items-center gap-1 tabular-nums">
              <Timer className="h-3 w-3" />
              {formatDuration(duration)}
            </span>
          )}
          {finishedAt !== null && (
            <span>
              {formatDistanceToNow(finishedAt, { addSuffix: true, locale: getDateLocale(language) })}
            </span>
          )}
          <button
            type="button"
            className="rounded-sm p-0.5 hover:bg-muted hover:text-foreground"
            onClick={() => onDetails(job.id)}
            aria-label={t('activity.details')}
            title={t('activity.details')}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="rounded-sm p-0.5 hover:bg-muted hover:text-foreground"
            onClick={() => onDismiss(job.id)}
            aria-label={t('activity.dismiss')}
            title={t('activity.dismiss')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {job.llm_usage?.length > 0 && <LlmUsageInline calls={job.llm_usage} />}
      {job.status === 'failed' && job.error && (
        <p className="line-clamp-3 whitespace-pre-wrap break-words rounded-sm bg-destructive-tint px-2 py-1 text-xs text-destructive">
          {job.error}
        </p>
      )}
      {job.retryable && job.target_id && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          disabled={retrying}
          onClick={() => onRetry(job.target_id as string)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('activity.retry')}
        </Button>
      )}
    </li>
  )
}
