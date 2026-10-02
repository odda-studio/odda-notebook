'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import {
  Activity as ActivityIcon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  FileText,
  FolderSync,
  History,
  Loader2,
  Mic,
  RotateCcw,
  Square,
  StickyNote,
  Timer,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  activeElapsedMs,
  ActivityGroup,
  finishedDurationMs,
  formatDuration,
  groupJobsByTarget,
  isWorkerStalled,
  parseTime,
  sourceHref,
  STAGE_LABEL_KEYS,
} from '@/components/activity/activity-utils'
import type { ActivityJob, ActivityTargetType } from '@/lib/api/activity'
import {
  useActivity,
  useCancelJob,
  useCancelTarget,
  useDismissFinished,
  useDismissJob,
} from '@/lib/hooks/use-activity'
import { useRetrySource } from '@/lib/hooks/use-sources'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'
import { cn } from '@/lib/utils'

type TFn = ReturnType<typeof useTranslation>['t']

const WINDOW_OPTIONS = [
  { hours: 1, labelKey: 'activity.window1h' },
  { hours: 24, labelKey: 'activity.window24h' },
  { hours: 168, labelKey: 'activity.window7d' },
] as const

const TARGET_ICONS: Record<ActivityTargetType, LucideIcon> = {
  source: FileText,
  note: StickyNote,
  link: FolderSync,
  podcast: Mic,
}

/** Current time, re-rendered every second so elapsed timers tick live. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

function jobDetail(job: ActivityJob, t: TFn): string | null {
  if (!job.detail) return null
  if (job.stage === 'extraction') {
    const count = Number(job.detail)
    if (!Number.isFinite(count) || count <= 0) return null
    return t('activity.transformationsCount', { count })
  }
  return job.detail
}

function GroupHeader({
  group,
  t,
  actions,
}: {
  group: ActivityGroup
  t: TFn
  actions?: React.ReactNode
}) {
  const isSystem = group.targetType === null
  const Icon = isSystem ? Cpu : TARGET_ICONS[group.targetType as ActivityTargetType]
  const title = isSystem ? t('activity.system') : group.title || t('activity.untitled')
  const canLink = group.targetType === 'source' && group.exists && !!group.targetId

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className={cn('h-4 w-4 shrink-0', group.exists ? 'text-muted-foreground' : 'text-muted-foreground/50')} />
      {canLink ? (
        <Link
          href={sourceHref(group.targetId as string)}
          className="truncate font-medium hover:underline"
        >
          {title}
        </Link>
      ) : (
        <span className={cn('truncate font-medium', !group.exists && 'text-muted-foreground line-through')}>
          {title}
        </span>
      )}
      {!group.exists && (
        <span className="shrink-0 text-xs text-muted-foreground">{t('activity.deleted')}</span>
      )}
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
        {t('activity.jobsCount', { count: group.jobs.length })}
      </span>
      {actions}
    </div>
  )
}

/** "Stop all" / "Stop and delete source" for a group of in-progress jobs. */
function ActiveGroupActions({
  group,
  t,
  onCancelAll,
  onCancelAndDelete,
  busy,
}: {
  group: ActivityGroup
  t: TFn
  onCancelAll: () => void
  onCancelAndDelete: () => void
  busy: boolean
}) {
  const cancellable = group.targetType === 'source' || group.targetType === 'link'
  const allStopping = group.jobs.every((job) => job.cancel_requested)
  if (!cancellable || !group.targetId || allStopping) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={busy} onClick={onCancelAll}>
        <Square className="h-3 w-3" />
        {t('activity.stopAll')}
      </Button>
      {group.targetType === 'source' && group.exists && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 text-destructive hover:text-destructive"
          disabled={busy}
          onClick={onCancelAndDelete}
        >
          <Trash2 className="h-3 w-3" />
          {t('activity.stopAndDelete')}
        </Button>
      )}
    </span>
  )
}

function ActiveJobRow({
  job,
  now,
  t,
  onCancel,
  canceling,
}: {
  job: ActivityJob
  now: number
  t: TFn
  onCancel: (jobId: string) => void
  canceling: boolean
}) {
  const elapsed = activeElapsedMs(job, now)
  const detail = jobDetail(job, t)
  const running = job.status === 'running'
  const stopping = job.cancel_requested

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" data-testid="activity-active-job">
      {running ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
      ) : (
        <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="font-medium">{t(STAGE_LABEL_KEYS[job.stage])}</span>
      {detail && <span className="truncate text-muted-foreground">{detail}</span>}
      {stopping ? (
        <Badge variant="outline" className="text-destructive">{t('activity.statusStopping')}</Badge>
      ) : (
        <Badge variant={running ? 'default' : 'secondary'}>
          {running ? t('activity.statusRunning') : t('activity.waitingForWorker')}
        </Badge>
      )}
      <span className="ml-auto flex items-center gap-2">
        {elapsed !== null && (
          <span className="flex items-center gap-1 tabular-nums text-xs text-muted-foreground">
            <Timer className="h-3 w-3" />
            {formatDuration(elapsed)}
          </span>
        )}
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
    </li>
  )
}

function RecentJobRow({
  job,
  t,
  language,
  onRetry,
  retrying,
  onDismiss,
}: {
  job: ActivityJob
  t: TFn
  language: string
  onRetry: (sourceId: string) => void
  retrying: boolean
  onDismiss: (jobId: string) => void
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
        <span className="font-medium">{t(STAGE_LABEL_KEYS[job.stage])}</span>
        {detail && <span className="truncate text-muted-foreground">{detail}</span>}
        {statusBadge}
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
            onClick={() => onDismiss(job.id)}
            aria-label={t('activity.dismiss')}
            title={t('activity.dismiss')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
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

function CountTile({ label, value, tone }: { label: string; value: number; tone?: 'danger' | 'active' }) {
  return (
    <div className="rounded-md border bg-card px-4 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'font-display text-xl font-bold tabular-nums',
          tone === 'danger' && value > 0 && 'text-destructive',
          tone === 'active' && value > 0 && 'text-primary',
        )}
      >
        {value}
      </div>
    </div>
  )
}

export default function ActivityPage() {
  const { t, language } = useTranslation()
  const [hours, setHours] = useState(24)
  const [onlyFailures, setOnlyFailures] = useState(false)
  const [search, setSearch] = useState('')
  const now = useNow()

  const { data, isLoading, isError, refetch } = useActivity({ hours })
  const retrySource = useRetrySource()
  const cancelJob = useCancelJob()
  const cancelTarget = useCancelTarget()
  const dismissJob = useDismissJob()
  const dismissFinished = useDismissFinished()
  const [deleteGroup, setDeleteGroup] = useState<ActivityGroup | null>(null)

  const needle = search.trim().toLowerCase()
  const matchesSearch = (group: ActivityGroup) =>
    !needle || (group.title ?? '').toLowerCase().includes(needle)

  const activeGroups = useMemo(() => groupJobsByTarget(data?.active ?? []), [data?.active])
  const recentGroups = useMemo(() => {
    const jobs = (data?.recent ?? []).filter((job) => !onlyFailures || job.status === 'failed')
    return groupJobsByTarget(jobs)
  }, [data?.recent, onlyFailures])

  const visibleActive = activeGroups.filter(matchesSearch)
  const visibleRecent = recentGroups.filter(matchesSearch)
  const filtering = !!needle || onlyFailures

  const counts = data?.counts ?? { active: 0, queued: 0, running: 0, failed_recent: 0 }
  const stalled = !!data && isWorkerStalled(data.active, counts.running, now)

  const handleRetry = (sourceId: string) => {
    retrySource.mutate(sourceId, { onSuccess: () => void refetch() })
  }

  const cancelGroup = (group: ActivityGroup, deleteTarget: boolean) => {
    if (!group.targetId || (group.targetType !== 'source' && group.targetType !== 'link')) return
    cancelTarget.mutate(
      { target_type: group.targetType, target_id: group.targetId, delete_target: deleteTarget },
      { onSettled: () => setDeleteGroup(null) }
    )
  }

  const renderBody = () => {
    if (isLoading) {
      return (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner />
        </div>
      )
    }
    if (isError || !data) {
      return (
        <div className="py-12 text-center">
          <p className="mb-4 text-muted-foreground">{t('activity.loadFailed')}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            {t('activity.retry')}
          </Button>
        </div>
      )
    }

    return (
      <div className="space-y-8">
        {stalled && (
          <Alert variant="destructive" data-testid="activity-worker-warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('activity.workerWarningTitle')}</AlertTitle>
            <AlertDescription>{t('activity.workerWarning')}</AlertDescription>
          </Alert>
        )}

        <section className="space-y-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <Loader2 className={cn('h-4 w-4', counts.active > 0 && 'animate-spin')} />
            {t('activity.inProgress')}
          </h2>
          {visibleActive.length === 0 ? (
            filtering && activeGroups.length > 0 ? (
              <p className="text-sm text-muted-foreground">{t('activity.noMatches')}</p>
            ) : (
              <EmptyState
                icon={CheckCircle2}
                title={t('activity.noActive')}
                description={t('activity.noActiveDesc')}
              />
            )
          ) : (
            <div className="grid gap-3">
              {visibleActive.map((group) => (
                <Card key={group.key} className="gap-3 px-4 py-3" data-testid="activity-group">
                  <GroupHeader
                    group={group}
                    t={t}
                    actions={
                      <ActiveGroupActions
                        group={group}
                        t={t}
                        busy={cancelTarget.isPending}
                        onCancelAll={() => cancelGroup(group, false)}
                        onCancelAndDelete={() => setDeleteGroup(group)}
                      />
                    }
                  />
                  <ol className="space-y-2 border-l pl-3">
                    {group.jobs.map((job) => (
                      <ActiveJobRow
                        key={job.id}
                        job={job}
                        now={now}
                        t={t}
                        onCancel={(jobId) => cancelJob.mutate(jobId)}
                        canceling={cancelJob.isPending}
                      />
                    ))}
                  </ol>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <History className="h-4 w-4" />
              {t('activity.recent')}
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={onlyFailures}
                  onCheckedChange={(checked) => setOnlyFailures(checked === true)}
                  aria-label={t('activity.onlyFailures')}
                />
                {t('activity.onlyFailures')}
              </label>
              {recentGroups.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  disabled={dismissFinished.isPending}
                  onClick={() => dismissFinished.mutate(hours)}
                >
                  <X className="h-3.5 w-3.5" />
                  {t('activity.clearFinished')}
                </Button>
              )}
            </div>
          </div>
          {visibleRecent.length === 0 ? (
            filtering ? (
              <p className="text-sm text-muted-foreground">{t('activity.noMatches')}</p>
            ) : (
              <EmptyState
                icon={History}
                title={t('activity.noRecent')}
                description={t('activity.noRecentDesc')}
              />
            )
          ) : (
            <div className="grid gap-3">
              {visibleRecent.map((group) => (
                <Card key={group.key} className="gap-3 px-4 py-3" data-testid="activity-group">
                  <GroupHeader group={group} t={t} />
                  <ol className="space-y-3 border-l pl-3">
                    {group.jobs.map((job) => (
                      <RecentJobRow
                        key={job.id}
                        job={job}
                        t={t}
                        language={language}
                        onRetry={handleRetry}
                        retrying={retrySource.isPending}
                        onDismiss={(jobId) => dismissJob.mutate(jobId)}
                      />
                    ))}
                  </ol>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    )
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-6 py-6">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
                <ActivityIcon className="h-6 w-6" />
                {t('activity.title')}
              </h1>
              <p className="mt-2 text-muted-foreground">{t('activity.description')}</p>
            </div>
            <Select value={String(hours)} onValueChange={(value) => setHours(Number(value))}>
              <SelectTrigger className="w-44" aria-label={t('activity.window')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOW_OPTIONS.map((option) => (
                  <SelectItem key={option.hours} value={String(option.hours)}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mb-6 flex flex-wrap items-center gap-3">
            <CountTile label={t('activity.running')} value={counts.running} tone="active" />
            <CountTile label={t('activity.queued')} value={counts.queued} />
            <CountTile label={t('activity.failed')} value={counts.failed_recent} tone="danger" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('activity.searchPlaceholder')}
              aria-label={t('activity.searchPlaceholder')}
              className="ml-auto w-full sm:w-64"
            />
          </div>

          {renderBody()}
        </div>
      </div>

      <ConfirmDialog
        open={deleteGroup !== null}
        onOpenChange={(open) => !open && setDeleteGroup(null)}
        title={t('activity.stopAndDeleteTitle')}
        description={t('activity.stopAndDeleteConfirm', {
          title: deleteGroup?.title || t('activity.untitled'),
        })}
        confirmText={t('activity.stopAndDelete')}
        confirmVariant="destructive"
        isLoading={cancelTarget.isPending}
        onConfirm={() => deleteGroup && cancelGroup(deleteGroup, true)}
      />
    </AppShell>
  )
}
