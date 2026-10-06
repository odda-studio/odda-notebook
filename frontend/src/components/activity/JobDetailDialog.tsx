'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Loader2, Square } from 'lucide-react'

import { LlmUsageDetail } from '@/components/common/LlmUsageView'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ActivityJobDetail } from '@/lib/api/activity'
import { useActivityJob, useCancelJob } from '@/lib/hooks/use-activity'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'
import {
  activeElapsedMs,
  finishedDurationMs,
  formatDuration,
  parseTime,
  STAGE_LABEL_KEYS,
  stepLabel,
} from './activity-utils'
import { ProgressLine, TargetLabel, type TFn } from './ActivityJobRows'

function StatusBadge({ job, t }: { job: ActivityJobDetail; t: TFn }) {
  if (job.cancel_requested && (job.status === 'new' || job.status === 'running')) {
    return <Badge variant="outline" className="text-destructive">{t('activity.statusStopping')}</Badge>
  }
  switch (job.status) {
    case 'running':
      return <Badge>{t('activity.statusRunning')}</Badge>
    case 'new':
      return <Badge variant="secondary">{t('activity.waitingForWorker')}</Badge>
    case 'failed':
      return <Badge variant="destructive">{t('activity.statusFailed')}</Badge>
    case 'canceled':
      return <Badge variant="secondary">{t('activity.statusCanceled')}</Badge>
    default:
      return <Badge variant="default">{t('activity.statusCompleted')}</Badge>
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  )
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

/**
 * Everything about one background job, refreshed every second while it is
 * queued/running: live step, step timeline, timings, input and output.
 */
export function JobDetailDialog({
  jobId,
  onOpenChange,
}: {
  jobId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const { t, language } = useTranslation()
  const { data: job, isLoading, isError } = useActivityJob(jobId)
  const cancelJob = useCancelJob()
  const [now, setNow] = useState(() => Date.now())
  const active = job?.status === 'new' || job?.status === 'running'

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])

  const locale = getDateLocale(language)
  const time = (value: string | null) => {
    const ms = parseTime(value)
    return ms === null ? '—' : format(ms, 'PPpp', { locale })
  }
  const start = job ? parseTime(job.started_at) ?? parseTime(job.created) : null
  const elapsed = job ? (active ? activeElapsedMs(job, now) : finishedDurationMs(job)) : null

  return (
    <Dialog open={jobId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="activity-job-detail">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {job ? t(STAGE_LABEL_KEYS[job.stage]) : t('activity.details')}
            {job && <StatusBadge job={job} t={t} />}
            {active && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          </DialogTitle>
          <DialogDescription>{t('activity.detailsDescription')}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        ) : isError || !job ? (
          <p className="text-sm text-destructive">{t('activity.detailsLoadFailed')}</p>
        ) : (
          <div className="space-y-5">
            {active && job.progress && <ProgressLine progress={job.progress} t={t} now={now} />}

            <dl className="grid gap-3 sm:grid-cols-2">
              <Field label={t('activity.target')}>
                <TargetLabel job={job} t={t} />
              </Field>
              {job.detail && <Field label={t('activity.detailLabel')}>{job.detail}</Field>}
              {job.notebooks.length > 0 && (
                <Field label={t('activity.notebooks')}>{job.notebooks.join(', ')}</Field>
              )}
              <Field label={t('activity.queuedAt')}>{time(job.created)}</Field>
              <Field label={t('activity.startedAt')}>{time(job.started_at)}</Field>
              <Field label={t('activity.finishedAt')}>{time(job.finished_at)}</Field>
              <Field label={active ? t('activity.elapsed') : t('activity.duration')}>
                {elapsed === null ? '—' : formatDuration(elapsed)}
              </Field>
              <Field label={t('activity.attempts')}>{job.attempts || '—'}</Field>
              {job.cancel_requested_at && (
                <Field label={t('activity.stopRequestedAt')}>{time(job.cancel_requested_at)}</Field>
              )}
              <Field label={t('activity.jobId')}>
                <span className="font-mono text-xs">{job.id}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{job.name}</span>
              </Field>
            </dl>

            {job.full_error && job.status === 'failed' && (
              <section className="space-y-1">
                <h3 className="text-sm font-medium">{t('activity.error')}</h3>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-destructive-tint p-3 text-xs text-destructive">
                  {job.full_error}
                </pre>
              </section>
            )}

            {job.llm_usage.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">{t('llmUsage.title')}</h3>
                {job.llm_usage.map((usage, index) => (
                  <LlmUsageDetail key={index} usage={usage} />
                ))}
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-sm font-medium">{t('activity.timeline')}</h3>
              {job.progress_log.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('activity.noTimeline')}</p>
              ) : (
                <ol className="space-y-1.5 border-l pl-3" data-testid="activity-timeline">
                  {job.progress_log.map((entry, index) => {
                    const at = parseTime(entry.at)
                    return (
                      <li key={`${entry.step}-${index}`} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                        <span className="tabular-nums text-muted-foreground">
                          {at === null ? '—' : format(at, 'HH:mm:ss')}
                          {at !== null && start !== null && ` (+${formatDuration(at - start)})`}
                        </span>
                        <span className="font-medium">{stepLabel(entry.step, t)}</span>
                        {entry.total !== null && entry.current !== null && (
                          <span className="tabular-nums">
                            {entry.current}/{entry.total}
                          </span>
                        )}
                        {entry.detail && (
                          <span className="break-all text-muted-foreground">{entry.detail}</span>
                        )}
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>

            <details className="space-y-2">
              <summary className="cursor-pointer text-sm font-medium">{t('activity.input')}</summary>
              <Json value={job.args} />
            </details>
            {job.result && (
              <details className="space-y-2">
                <summary className="cursor-pointer text-sm font-medium">{t('activity.output')}</summary>
                <Json value={job.result} />
              </details>
            )}

            {active && !job.cancel_requested && (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  disabled={cancelJob.isPending}
                  onClick={() => cancelJob.mutate(job.id)}
                >
                  <Square className="h-3.5 w-3.5" />
                  {t('activity.stop')}
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
