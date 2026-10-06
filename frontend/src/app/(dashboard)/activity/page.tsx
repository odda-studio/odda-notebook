'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity as ActivityIcon,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  History,
  Layers,
  ListTree,
  Loader2,
  Square,
  Trash2,
  X,
} from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ActivityGroup,
  groupJobsByStage,
  groupJobsByTarget,
  isWorkerStalled,
  sourceHref,
  STAGE_LABEL_KEYS,
  STAGE_ORDER,
  stoppableIds,
} from '@/components/activity/activity-utils'
import {
  ActiveJobRow,
  RecentJobRow,
  TARGET_ICONS,
  type TFn,
} from '@/components/activity/ActivityJobRows'
import { JobDetailDialog } from '@/components/activity/JobDetailDialog'
import type { ActivityJob, ActivityStage, ActivityTargetType } from '@/lib/api/activity'
import {
  useActivity,
  useCancelJob,
  useCancelJobs,
  useCancelTarget,
  useDismissFinished,
  useDismissJob,
} from '@/lib/hooks/use-activity'
import { useRetrySource } from '@/lib/hooks/use-sources'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

const WINDOW_OPTIONS = [
  { hours: 1, labelKey: 'activity.window1h' },
  { hours: 24, labelKey: 'activity.window24h' },
  { hours: 168, labelKey: 'activity.window7d' },
] as const

type ViewMode = 'target' | 'stage'

/** Current time, re-rendered every second so elapsed timers tick live. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Group-level "select all" checkbox over the stoppable jobs of a group. */
function GroupCheckbox({
  jobs,
  selected,
  onChange,
  t,
}: {
  jobs: ActivityJob[]
  selected: Set<string>
  onChange: (ids: string[], selected: boolean) => void
  t: TFn
}) {
  const ids = stoppableIds(jobs)
  const picked = ids.filter((id) => selected.has(id)).length
  return (
    <Checkbox
      checked={ids.length > 0 && picked === ids.length ? true : picked > 0 ? 'indeterminate' : false}
      disabled={ids.length === 0}
      onCheckedChange={(checked) => onChange(ids, checked === true)}
      aria-label={t('activity.selectGroup')}
    />
  )
}

function GroupHeader({
  group,
  t,
  leading,
  actions,
}: {
  group: ActivityGroup
  t: TFn
  leading?: React.ReactNode
  actions?: React.ReactNode
}) {
  const isSystem = group.targetType === null
  const Icon = isSystem ? Cpu : TARGET_ICONS[group.targetType as ActivityTargetType]
  const title = isSystem ? t('activity.system') : group.title || t('activity.untitled')
  const canLink = group.targetType === 'source' && group.exists && !!group.targetId

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {leading}
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
  if (stoppableIds(group.jobs).length === 0) return null
  const isSource = group.targetType === 'source' && !!group.targetId
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button size="sm" variant="outline" className="h-7 gap-1.5" disabled={busy} onClick={onCancelAll}>
        <Square className="h-3 w-3" />
        {t('activity.stopAll')}
      </Button>
      {isSource && group.exists && (
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

/** One chip per stage with jobs in progress; clicking filters the lists to it. */
function StageChips({
  jobs,
  stage,
  onChange,
  t,
}: {
  jobs: ActivityJob[]
  stage: ActivityStage | null
  onChange: (stage: ActivityStage | null) => void
  t: TFn
}) {
  const counts = new Map<ActivityStage, { running: number; queued: number }>()
  for (const job of jobs) {
    const entry = counts.get(job.stage) ?? { running: 0, queued: 0 }
    if (job.status === 'running') entry.running += 1
    else entry.queued += 1
    counts.set(job.stage, entry)
  }
  const stages = STAGE_ORDER.filter((s) => counts.has(s) || s === stage)
  if (stages.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="activity-stage-chips">
      {stages.map((s) => {
        const entry = counts.get(s) ?? { running: 0, queued: 0 }
        const active = stage === s
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(active ? null : s)}
            aria-pressed={active}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
              active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
            )}
          >
            <span className="font-medium">{t(STAGE_LABEL_KEYS[s])}</span>
            <span className="tabular-nums">
              {t('activity.stageCounts', { running: entry.running, queued: entry.queued })}
            </span>
            {active && <X className="h-3 w-3" />}
          </button>
        )
      })}
    </div>
  )
}

export default function ActivityPage() {
  const { t, language } = useTranslation()
  const [hours, setHours] = useState(24)
  const [onlyFailures, setOnlyFailures] = useState(false)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<ViewMode>('target')
  const [stageFilter, setStageFilter] = useState<ActivityStage | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailJobId, setDetailJobId] = useState<string | null>(null)
  const [deleteGroup, setDeleteGroup] = useState<ActivityGroup | null>(null)
  const [confirmStopAll, setConfirmStopAll] = useState(false)
  const now = useNow()

  const { data, isLoading, isError, refetch } = useActivity({ hours })
  const retrySource = useRetrySource()
  const cancelJob = useCancelJob()
  const cancelJobs = useCancelJobs()
  const cancelTarget = useCancelTarget()
  const dismissJob = useDismissJob()
  const dismissFinished = useDismissFinished()

  const needle = search.trim().toLowerCase()
  const matches = (job: ActivityJob) =>
    (!needle ||
      (job.target_title ?? '').toLowerCase().includes(needle) ||
      (job.detail ?? '').toLowerCase().includes(needle) ||
      (job.progress?.detail ?? '').toLowerCase().includes(needle)) &&
    (!stageFilter || job.stage === stageFilter)

  const activeJobs = useMemo(() => data?.active ?? [], [data?.active])
  const visibleActiveJobs = activeJobs.filter(matches)
  const visibleRecentJobs = (data?.recent ?? [])
    .filter((job) => !onlyFailures || job.status === 'failed')
    .filter(matches)
  const filtering = !!needle || onlyFailures || !!stageFilter

  // Keep only selections of jobs that are still in progress and stoppable
  const stoppable = useMemo(() => new Set(stoppableIds(activeJobs)), [activeJobs])
  const selectedIds = [...selected].filter((id) => stoppable.has(id))

  const counts = data?.counts ?? { active: 0, queued: 0, running: 0, failed_recent: 0 }
  const stalled = !!data && isWorkerStalled(data.active, counts.running, now)

  const setSelection = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })

  const handleRetry = (sourceId: string) => {
    retrySource.mutate(sourceId, { onSuccess: () => void refetch() })
  }

  const cancelGroup = (group: ActivityGroup, deleteTarget: boolean) => {
    if (group.targetId && (group.targetType === 'source' || group.targetType === 'link')) {
      cancelTarget.mutate(
        { target_type: group.targetType, target_id: group.targetId, delete_target: deleteTarget },
        { onSettled: () => setDeleteGroup(null) }
      )
    } else {
      cancelJobs.mutate({ job_ids: stoppableIds(group.jobs) })
    }
  }

  const stopSelected = () =>
    cancelJobs.mutate({ job_ids: selectedIds }, { onSuccess: () => setSelected(new Set()) })

  const stopEverything = () =>
    cancelJobs.mutate(
      { all: true },
      {
        onSettled: () => {
          setConfirmStopAll(false)
          setSelected(new Set())
        },
      }
    )

  const renderActiveRows = (jobs: ActivityJob[], showTarget: boolean) => (
    <ol className="space-y-3 border-l pl-3">
      {jobs.map((job) => (
        <ActiveJobRow
          key={job.id}
          job={job}
          now={now}
          t={t}
          showTarget={showTarget}
          selected={selected.has(job.id)}
          onSelect={(id, on) => setSelection([id], on)}
          onCancel={(jobId) => cancelJob.mutate(jobId)}
          onDetails={setDetailJobId}
          canceling={cancelJob.isPending}
        />
      ))}
    </ol>
  )

  const renderRecentRows = (jobs: ActivityJob[], showTarget: boolean) => (
    <ol className="space-y-3 border-l pl-3">
      {jobs.map((job) => (
        <RecentJobRow
          key={job.id}
          job={job}
          t={t}
          language={language}
          showTarget={showTarget}
          onRetry={handleRetry}
          retrying={retrySource.isPending}
          onDismiss={(jobId) => dismissJob.mutate(jobId)}
          onDetails={setDetailJobId}
        />
      ))}
    </ol>
  )

  const renderActive = () => {
    if (view === 'stage') {
      return groupJobsByStage(visibleActiveJobs).map(({ stage, jobs }) => {
        const running = jobs.filter((job) => job.status === 'running').length
        return (
          <Card key={stage} className="gap-3 px-4 py-3" data-testid="activity-group">
            <div className="flex flex-wrap items-center gap-2">
              <GroupCheckbox jobs={jobs} selected={selected} onChange={setSelection} t={t} />
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{t(STAGE_LABEL_KEYS[stage])}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {t('activity.stageCounts', { running, queued: jobs.length - running })}
              </span>
              {stoppableIds(jobs).length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5"
                  disabled={cancelJobs.isPending}
                  onClick={() => cancelJobs.mutate({ job_ids: stoppableIds(jobs) })}
                >
                  <Square className="h-3 w-3" />
                  {t('activity.stopPhase')}
                </Button>
              )}
            </div>
            {renderActiveRows(jobs, true)}
          </Card>
        )
      })
    }
    return groupJobsByTarget(visibleActiveJobs).map((group) => (
      <Card key={group.key} className="gap-3 px-4 py-3" data-testid="activity-group">
        <GroupHeader
          group={group}
          t={t}
          leading={<GroupCheckbox jobs={group.jobs} selected={selected} onChange={setSelection} t={t} />}
          actions={
            <ActiveGroupActions
              group={group}
              t={t}
              busy={cancelTarget.isPending || cancelJobs.isPending}
              onCancelAll={() => cancelGroup(group, false)}
              onCancelAndDelete={() => setDeleteGroup(group)}
            />
          }
        />
        {renderActiveRows(group.jobs, false)}
      </Card>
    ))
  }

  const renderRecent = () => {
    if (view === 'stage') {
      return groupJobsByStage(visibleRecentJobs).map(({ stage, jobs }) => (
        <Card key={stage} className="gap-3 px-4 py-3" data-testid="activity-group">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{t(STAGE_LABEL_KEYS[stage])}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {t('activity.jobsCount', { count: jobs.length })}
            </span>
          </div>
          {renderRecentRows(jobs, true)}
        </Card>
      ))
    }
    return groupJobsByTarget(visibleRecentJobs).map((group) => (
      <Card key={group.key} className="gap-3 px-4 py-3" data-testid="activity-group">
        <GroupHeader group={group} t={t} />
        {renderRecentRows(group.jobs, false)}
      </Card>
    ))
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <Loader2 className={cn('h-4 w-4', counts.active > 0 && 'animate-spin')} />
              {t('activity.inProgress')}
            </h2>
            {stoppable.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-destructive hover:text-destructive"
                disabled={cancelJobs.isPending}
                onClick={() => setConfirmStopAll(true)}
              >
                <Square className="h-3.5 w-3.5" />
                {t('activity.stopEverything', { count: stoppable.size })}
              </Button>
            )}
          </div>

          {selectedIds.length > 0 && (
            <div
              className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-sm"
              data-testid="activity-selection-bar"
            >
              <span className="text-sm font-medium">
                {t('activity.selectedCount', { count: selectedIds.length })}
              </span>
              <Button
                size="sm"
                variant="destructive"
                className="ml-auto h-7 gap-1.5"
                disabled={cancelJobs.isPending}
                onClick={stopSelected}
              >
                <Square className="h-3 w-3" />
                {t('activity.stopSelected')}
              </Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelected(new Set())}>
                {t('activity.clearSelection')}
              </Button>
            </div>
          )}

          {visibleActiveJobs.length === 0 ? (
            filtering && activeJobs.length > 0 ? (
              <p className="text-sm text-muted-foreground">{t('activity.noMatches')}</p>
            ) : (
              <EmptyState
                icon={CheckCircle2}
                title={t('activity.noActive')}
                description={t('activity.noActiveDesc')}
              />
            )
          ) : (
            <div className="grid gap-3">{renderActive()}</div>
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
              {(data.recent ?? []).length > 0 && (
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
          {visibleRecentJobs.length === 0 ? (
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
            <div className="grid gap-3">{renderRecent()}</div>
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

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <CountTile label={t('activity.running')} value={counts.running} tone="active" />
            <CountTile label={t('activity.queued')} value={counts.queued} />
            <CountTile label={t('activity.failed')} value={counts.failed_recent} tone="danger" />
            <div className="ml-auto flex w-full flex-wrap items-center gap-3 sm:w-auto">
              <Tabs value={view} onValueChange={(value) => setView(value as ViewMode)}>
                <TabsList>
                  <TabsTrigger value="target" className="gap-1.5">
                    <ListTree className="h-3.5 w-3.5" />
                    {t('activity.viewByItem')}
                  </TabsTrigger>
                  <TabsTrigger value="stage" className="gap-1.5">
                    <Layers className="h-3.5 w-3.5" />
                    {t('activity.viewByPhase')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('activity.searchPlaceholder')}
                aria-label={t('activity.searchPlaceholder')}
                className="w-full sm:w-56"
              />
            </div>
          </div>

          <div className="mb-6">
            <StageChips jobs={activeJobs} stage={stageFilter} onChange={setStageFilter} t={t} />
          </div>

          {renderBody()}
        </div>
      </div>

      <JobDetailDialog jobId={detailJobId} onOpenChange={(open) => !open && setDetailJobId(null)} />

      <ConfirmDialog
        open={confirmStopAll}
        onOpenChange={setConfirmStopAll}
        title={t('activity.stopEverythingTitle')}
        description={t('activity.stopEverythingConfirm', { count: stoppable.size })}
        confirmText={t('activity.stopEverything', { count: stoppable.size })}
        confirmVariant="destructive"
        isLoading={cancelJobs.isPending}
        onConfirm={stopEverything}
      />

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
