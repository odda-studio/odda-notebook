'use client'

import { useState } from 'react'
import { ExternalLink, Loader2, RefreshCw, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  useDisconnectSource,
  useSourceCloudEntry,
  useSourceCloudInfo,
  useTriggerSourceSync,
  useUpdateSourceSync,
} from '@/lib/hooks/use-integrations'
import {
  FileStatusBadge,
  LinkKindIcon,
  openInProviderKey,
  ProviderIcon,
  providerNameKey,
  RelativeTime,
  SyncStatusBadge,
} from './integration-utils'
import { RemoveCloudDialog } from './RemoveCloudDialog'

interface SourceCloudSyncSectionProps {
  sourceId: string
  /** Called when the user deletes the source from here (e.g. close its view). */
  onSourceDeleted?: () => void
}

/** "Cloud sync" block of the source detail view; renders nothing for non-cloud sources. */
export function SourceCloudSyncSection({ sourceId, onSourceDeleted }: SourceCloudSyncSectionProps) {
  const { t } = useTranslation()
  const mapEntry = useSourceCloudEntry(sourceId)
  // The map says whether the source is cloud-imported; the per-source call keeps it fresh
  const { data: fresh } = useSourceCloudInfo(sourceId, !!mapEntry)
  const updateSync = useUpdateSourceSync()
  const triggerSync = useTriggerSourceSync()
  const disconnect = useDisconnectSource()
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const info = fresh ?? mapEntry
  if (!info) return null

  const isBusy = info.link_status === 'queued' || info.link_status === 'running'
  const fromFolder = info.link_kind === 'folder'
  const toggleId = `source-cloud-sync-${sourceId}`

  return (
    <section className="border-t border-border pt-5 space-y-3" data-testid="source-cloud-sync">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-medium">{t('integrations.cloudSyncTitle')}</h3>
        <div className="flex items-center gap-2">
          <SyncStatusBadge status={info.link_status} />
          <FileStatusBadge status={info.file_status} />
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 text-sm">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('integrations.origin')}</dt>
          <dd className="flex items-center gap-1.5 flex-wrap">
            <ProviderIcon provider={info.provider} />
            <span>{t(providerNameKey(info.provider))}</span>
            <span className="text-muted-foreground">· {info.account_name}</span>
          </dd>
          {info.remote_path && (
            <dd className="font-mono text-xs break-all text-muted-foreground">{info.remote_path}</dd>
          )}
          {info.web_url && (
            <dd>
              <a
                href={info.web_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {t(openInProviderKey(info.provider))}
                <ExternalLink className="h-3 w-3" />
              </a>
            </dd>
          )}
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">{t('integrations.linkedVia')}</dt>
          <dd className="flex items-center gap-1.5">
            <LinkKindIcon kind={info.link_kind} className="text-muted-foreground" />
            <span className="break-all">{info.link_name}</span>
            <span className="text-xs text-muted-foreground">
              ({fromFolder ? t('integrations.kindFolder') : t('integrations.kindFile')})
            </span>
          </dd>
          <dd className="text-xs text-muted-foreground">
            {t('integrations.lastSync')}:{' '}
            <RelativeTime value={info.last_sync_at} fallback={t('integrations.never')} />
          </dd>
        </div>
      </dl>

      {info.last_error && <p className="text-xs text-destructive break-words">{info.last_error}</p>}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2">
          <Checkbox
            id={toggleId}
            checked={info.sync_enabled}
            disabled={updateSync.isPending}
            onCheckedChange={v => updateSync.mutate({ sourceId, syncEnabled: v === true })}
            className="mt-0.5"
          />
          <div>
            <Label htmlFor={toggleId}>{t('integrations.keepSourceInSync')}</Label>
            <p className="text-xs text-muted-foreground max-w-prose">
              {fromFolder
                ? t('integrations.sourceSyncFolderHint')
                : t('integrations.sourceSyncFileHint')}
            </p>
            {fromFolder && !info.link_sync_enabled && (
              <p className="text-xs text-muted-foreground">{t('integrations.linkSyncOffHint')}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => triggerSync.mutate(sourceId)}
            disabled={isBusy || triggerSync.isPending}
          >
            {triggerSync.isPending || isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t('integrations.syncNow')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDisconnectOpen(true)}
          >
            <Unplug className="h-4 w-4" />
            {t('integrations.disconnectSource')}
          </Button>
        </div>
      </div>

      <RemoveCloudDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={t('integrations.disconnectSourceTitle')}
        description={
          fromFolder
            ? t('integrations.disconnectSourceFolderConfirm', { name: info.link_name })
            : t('integrations.disconnectSourceFileConfirm')
        }
        confirmText={t('integrations.disconnectSource')}
        deleteLabel={t('integrations.alsoDeleteThisSource')}
        onConfirm={deleteSource =>
          disconnect.mutate(
            { sourceId, deleteSource },
            {
              onSuccess: result => {
                setDisconnectOpen(false)
                if (result.sources_deleted) onSourceDeleted?.()
              },
            }
          )
        }
        isLoading={disconnect.isPending}
      />
    </section>
  )
}
