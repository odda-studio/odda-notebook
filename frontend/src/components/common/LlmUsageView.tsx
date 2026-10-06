'use client'

import { AlertTriangle, Cpu } from 'lucide-react'

import { Progress } from '@/components/ui/progress'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { LlmUsage } from '@/lib/types/llm-usage'
import { cn } from '@/lib/utils'

/** "12.3k" style compact token counts. */
export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

export function budgetExhausted(usage: LlmUsage): boolean {
  return usage.finish_reason === 'length'
}

/** Share of the output budget used, 0–100, or null when unknown. */
export function budgetPercent(usage: LlmUsage): number | null {
  if (!usage.max_output_tokens || usage.output_tokens === null) return null
  return Math.min(100, Math.round((usage.output_tokens / usage.max_output_tokens) * 100))
}

/** Sum of several calls (a job may call the model more than once). */
export function sumUsage(calls: LlmUsage[]): { input: number; output: number; reasoning: number } {
  return calls.reduce(
    (acc, call) => ({
      input: acc.input + (call.input_tokens ?? 0),
      output: acc.output + (call.output_tokens ?? 0),
      reasoning: acc.reasoning + (call.reasoning_tokens ?? 0),
    }),
    { input: 0, output: 0, reasoning: 0 }
  )
}

/** One-line summary: "5.1k in · 9.0k out (7.0k reasoning) · 27% of 32.8k". */
export function LlmUsageInline({ calls, className }: { calls: LlmUsage[]; className?: string }) {
  const { t } = useTranslation()
  if (calls.length === 0) return null
  const total = sumUsage(calls)
  const exhausted = calls.some(budgetExhausted)
  const last = calls[calls.length - 1]
  const percent = calls.length === 1 ? budgetPercent(last) : null
  return (
    <span
      className={cn(
        'inline-flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums text-muted-foreground',
        exhausted && 'text-destructive',
        className
      )}
      data-testid="llm-usage-inline"
      title={last.model ?? undefined}
    >
      {exhausted ? <AlertTriangle className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}
      <span>{t('llmUsage.inShort', { value: formatTokens(total.input) })}</span>
      <span>·</span>
      <span>{t('llmUsage.outShort', { value: formatTokens(total.output) })}</span>
      {total.reasoning > 0 && (
        <span>({t('llmUsage.reasoningShort', { value: formatTokens(total.reasoning) })})</span>
      )}
      {percent !== null && (
        <>
          <span>·</span>
          <span>
            {t('llmUsage.budgetShort', { percent, max: formatTokens(last.max_output_tokens) })}
          </span>
        </>
      )}
      {calls.length > 1 && <span>· {t('llmUsage.callsCount', { count: calls.length })}</span>}
    </span>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm tabular-nums">{value}</dd>
    </div>
  )
}

/** Every figure of one call, with the output budget bar. */
export function LlmUsageDetail({ usage }: { usage: LlmUsage }) {
  const { t } = useTranslation()
  const percent = budgetPercent(usage)
  const exhausted = budgetExhausted(usage)
  const n = (value: number | null) => (value === null ? '—' : value.toLocaleString())
  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="llm-usage-detail">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{usage.model ?? t('llmUsage.unknownModel')}</span>
        {usage.duration_seconds !== null && (
          <span className="text-xs text-muted-foreground">{usage.duration_seconds}s</span>
        )}
        {exhausted && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {t('llmUsage.budgetExhausted')}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Row label={t('llmUsage.input')} value={n(usage.input_tokens)} />
        <Row label={t('llmUsage.estimate')} value={n(usage.prompt_tokens_estimate)} />
        <Row label={t('llmUsage.cached')} value={n(usage.cached_input_tokens)} />
        <Row label={t('llmUsage.total')} value={n(usage.total_tokens)} />
        <Row label={t('llmUsage.output')} value={n(usage.output_tokens)} />
        <Row label={t('llmUsage.reasoning')} value={n(usage.reasoning_tokens)} />
        <Row label={t('llmUsage.budget')} value={n(usage.max_output_tokens)} />
        <Row label={t('llmUsage.finishReason')} value={usage.finish_reason ?? '—'} />
      </dl>
      {percent !== null && (
        <div className="space-y-1">
          <Progress value={percent} className={cn('h-1.5', exhausted && '[&>div]:bg-destructive')} />
          <p className={cn('text-xs text-muted-foreground', exhausted && 'text-destructive')}>
            {t('llmUsage.budgetUsed', {
              percent,
              used: n(usage.output_tokens),
              max: n(usage.max_output_tokens),
            })}
          </p>
        </div>
      )}
    </div>
  )
}
