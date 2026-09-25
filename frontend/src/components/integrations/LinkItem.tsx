'use client'

import { useState } from 'react'
import { ChevronDown, ExternalLink, Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useDeleteLink, useTriggerLinkSync, useUpdateLink } from '@/lib/hooks/use-integrations'
import type { SyncLink } from '@/lib/api/integrations'
import {
  LinkKindIcon,
  openInProviderKey,
  ProviderIcon,
  RelativeTime,
  SyncStatusBadge,
} from './integration-utils'
import { LinkEditDialog } from './LinkEditDialog'
import { SyncedFileList } from './SyncedFileList'

interface LinkItemProps {
  link: SyncLink
}

export function LinkItem({ link }: LinkItemProps) {
  const { t } = useTranslation()
  const [filesOpen, setFilesOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const updateLink = useUpdateLink({ silent: true })
  const deleteLink = useDeleteLink()
  const triggerSync = useTriggerLinkSync()

  const isBusy = link.status === 'queued' || link.status === 'running'
  const isFolder = link.kind === 'folder'
  const toggleId = `link-sync-${link.id}`

  return (
    <li className="rounded-md border p-3 space-y-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <LinkKindIcon kind={link.kind} className="text-muted-foreground" />
            <span className="font-medium break-all">{link.name}</span>
            <SyncStatusBadge status={link.status} />
            {!link.sync_enabled && (
              <Badge variant="outline" className="text-muted-foreground">
                {t('integrations.syncOff')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
            <ProviderIcon provider={link.provider} className="h-3.5 w-3.5" />
            <span>{link.account_name}</span>
            <span aria-hidden>·</span>
            <span className="font-mono break-all">{link.remote_path}</span>
            {link.web_url && (
              <a
                href={link.web_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {t(openInProviderKey(link.provider))}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-muted-foreground">{t('integrations.importedInto')}:</span>
            {link.notebook_ids.length === 0 ? (
              <Badge variant="outline">{t('integrations.generalSources')}</Badge>
            ) : (
              link.notebook_ids.map((id, i) => (
                <Badge key={id} variant="secondary">
                  {link.notebook_names[i] || t('integrations.unknownNotebook')}
                </Badge>
              ))
            )}
          </div>
          <div className="flex gap-x-4 gap-y-1 flex-wrap text-xs text-muted-foreground">
            <span>
              {t('integrations.lastSync')}:{' '}
              <RelativeTime value={link.last_sync_at} fallback={t('integrations.never')} />
            </span>
            <span>
              {t('integrations.nextSync')}:{' '}
              <RelativeTime
                value={link.sync_enabled ? link.next_sync_at : null}
                fallback={t('integrations.notScheduled')}
              />
            </span>
            {link.sync_enabled && (
              <span>{t('integrations.everyMinutes', { count: link.interval_minutes })}</span>
            )}
            <span>{t('integrations.fileCount', { count: link.file_count })}</span>
            {isFolder && link.recursive && <span>{t('integrations.recursive')}</span>}
          </div>
          {link.last_error && (
            <p className="text-xs text-destructive break-words">{link.last_error}</p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <div className="flex items-center gap-2 mr-1">
            <Checkbox
              id={toggleId}
              checked={link.sync_enabled}
              disabled={updateLink.isPending}
              onCheckedChange={v =>
                updateLink.mutate({ id: link.id, data: { sync_enabled: v === true } })
              }
            />
            <Label htmlFor={toggleId} className="text-sm">
              {t('integrations.keepInSync')}
            </Label>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => triggerSync.mutate(link.id)}
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
            variant="ghost"
            size="icon"
            onClick={() => setEditOpen(true)}
            aria-label={t('common.edit')}
            title={t('common.edit')}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            aria-label={t('common.delete')}
            title={t('common.delete')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isFolder && (
        <Collapsible open={filesOpen} onOpenChange={setFilesOpen}>
          <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className={`h-4 w-4 transition-transform ${filesOpen ? 'rotate-180' : ''}`} />
            {filesOpen ? t('integrations.hideFiles') : t('integrations.showFiles')}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            {filesOpen && <SyncedFileList linkId={link.id} provider={link.provider} poll={isBusy} />}
          </CollapsibleContent>
        </Collapsible>
      )}

      {editOpen && <LinkEditDialog open={editOpen} onOpenChange={setEditOpen} link={link} />}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('integrations.deleteLinkTitle')}
        description={t('integrations.deleteLinkConfirm', { name: link.name })}
        confirmText={t('integrations.deleteLink')}
        confirmVariant="destructive"
        onConfirm={() => deleteLink.mutate(link.id, { onSettled: () => setDeleteOpen(false) })}
        isLoading={deleteLink.isPending}
      />
    </li>
  )
}
