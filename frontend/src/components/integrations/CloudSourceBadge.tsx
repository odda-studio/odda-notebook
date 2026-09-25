'use client'

import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useSourceCloudEntry } from '@/lib/hooks/use-integrations'
import { ProviderIcon, providerNameKey } from './integration-utils'

interface CloudSourceBadgeProps {
  sourceId: string
  className?: string
}

/**
 * Small provider badge for cloud-imported sources. Reads the shared
 * source-map query, so it can be dropped into memoized list rows.
 */
export function CloudSourceBadge({ sourceId, className }: CloudSourceBadgeProps) {
  const { t } = useTranslation()
  const info = useSourceCloudEntry(sourceId)
  if (!info) return null

  const isError = info.file_status === 'error' || !!info.last_error
  const provider = t(providerNameKey(info.provider))
  const state = isError
    ? t('integrations.badgeError')
    : info.sync_enabled
      ? t('integrations.badgeSynced')
      : t('integrations.badgePaused')
  const label = `${provider} · ${state}`

  return (
    <span
      data-testid="cloud-source-badge"
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-medium',
        isError
          ? 'bg-destructive/10 text-destructive'
          : info.sync_enabled
            ? 'bg-teal-tint text-teal'
            : 'bg-muted text-muted-foreground',
        className
      )}
      title={label}
      aria-label={label}
    >
      <ProviderIcon provider={info.provider} className="h-3 w-3" />
      {!info.sync_enabled && !isError && <span>{t('integrations.badgePaused')}</span>}
    </span>
  )
}
