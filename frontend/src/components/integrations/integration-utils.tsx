'use client'

import { formatDistanceToNow } from 'date-fns'
import { Cloud, HardDrive, Box, File, Folder } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getDateLocale } from '@/lib/utils/date-locale'
import type {
  IntegrationProviderName,
  LinkKind,
  SyncedFileStatus,
  SyncLinkStatus,
} from '@/lib/api/integrations'

/**
 * Remote id of each provider's root folder (Dropbox addresses the root with
 * an empty path, Google Drive with the "root" alias). Used when the user
 * selects the top level itself.
 */
export const ROOT_FOLDER_IDS: Record<IntegrationProviderName, string> = {
  dropbox: '',
  google_drive: 'root',
}

/** Source routes expect the full record id ("source:abc"). */
export function sourceHref(sourceId: string): string {
  const id = sourceId.includes(':') ? sourceId : `source:${sourceId}`
  return `/sources/${encodeURIComponent(id)}`
}

/** i18n key of the "Open in Dropbox / Google Drive" label for a provider. */
export function openInProviderKey(provider: IntegrationProviderName | string): string {
  return provider === 'dropbox' ? 'integrations.openInDropbox' : 'integrations.openInDrive'
}

/** i18n key of the provider display name (for badges and tooltips). */
export function providerNameKey(provider: IntegrationProviderName | string): string {
  return provider === 'dropbox' ? 'integrations.providerDropbox' : 'integrations.providerDrive'
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Parses a comma/space separated extension list into the API shape:
 * lowercase, without leading dots, de-duplicated, empty entries dropped.
 * ".PDF, docx,,  .md" -> ["pdf", "docx", "md"]
 */
export function parseExtensions(input: string): string[] {
  const seen = new Set<string>()
  for (const raw of input.split(/[,\s]+/)) {
    const ext = raw.trim().toLowerCase().replace(/^\.+/, '')
    if (ext) seen.add(ext)
  }
  return [...seen]
}

export function formatExtensions(extensions: string[]): string {
  return extensions.join(', ')
}

export function ProviderIcon({
  provider,
  className,
}: {
  provider: IntegrationProviderName | string
  className?: string
}) {
  const Icon = provider === 'dropbox' ? Box : provider === 'google_drive' ? HardDrive : Cloud
  return <Icon className={cn('h-4 w-4', className)} aria-hidden="true" />
}

export function LinkKindIcon({ kind, className }: { kind: LinkKind; className?: string }) {
  const Icon = kind === 'folder' ? Folder : File
  return <Icon className={cn('h-4 w-4', className)} aria-hidden="true" />
}

/** Relative time ("5 minutes ago" / "in 10 minutes") in the active UI locale. */
export function RelativeTime({ value, fallback }: { value: string | null; fallback: string }) {
  const { language } = useTranslation()
  if (!value) return <>{fallback}</>
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return <>{fallback}</>
  return (
    <time dateTime={value} title={date.toLocaleString()}>
      {formatDistanceToNow(date, { addSuffix: true, locale: getDateLocale(language) })}
    </time>
  )
}

export function SyncStatusBadge({ status }: { status: SyncLinkStatus }) {
  const { t } = useTranslation()
  switch (status) {
    case 'queued':
      return <Badge variant="secondary">{t('integrations.statusQueued')}</Badge>
    case 'running':
      return <Badge variant="default">{t('integrations.statusRunning')}</Badge>
    case 'error':
      return <Badge variant="destructive">{t('integrations.statusError')}</Badge>
    case 'idle':
    default:
      return <Badge variant="outline">{t('integrations.statusIdle')}</Badge>
  }
}

export function FileStatusBadge({ status }: { status: SyncedFileStatus }) {
  const { t } = useTranslation()
  switch (status) {
    case 'synced':
      return <Badge variant="default">{t('integrations.fileStatusSynced')}</Badge>
    case 'unsupported':
      return <Badge variant="secondary">{t('integrations.fileStatusUnsupported')}</Badge>
    case 'ignored':
      return <Badge variant="outline">{t('integrations.fileStatusIgnored')}</Badge>
    case 'excluded':
      return <Badge variant="outline">{t('integrations.fileStatusExcluded')}</Badge>
    case 'error':
    default:
      return <Badge variant="destructive">{t('integrations.fileStatusError')}</Badge>
  }
}
