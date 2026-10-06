'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Ban, ExternalLink, Pause, Play, Trash2, Undo2, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  useBulkSyncedFiles,
  useIncludeSyncedFile,
  useLinkFiles,
  useUpdateSyncedFile,
} from '@/lib/hooks/use-integrations'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import type {
  IntegrationProviderName,
  SyncedFile,
  SyncedFileBulkAction,
} from '@/lib/api/integrations'
import { ExcludeFileDialog } from './ExcludeFileDialog'
import { FileStatusBadge, openInProviderKey, RelativeTime, sourceHref } from './integration-utils'

interface SyncedFileListProps {
  linkId: string
  provider: IntegrationProviderName
  /** Poll while the link is syncing so new files show up live. */
  poll?: boolean
}

export function SyncedFileList({ linkId, provider, poll = false }: SyncedFileListProps) {
  const { t } = useTranslation()
  const { data: files, isLoading, isError, error } = useLinkFiles(linkId, { poll })
  const updateFile = useUpdateSyncedFile()
  const includeFile = useIncludeSyncedFile()
  const bulk = useBulkSyncedFiles()
  const [fileToExclude, setFileToExclude] = useState<SyncedFile | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Drop selections of files that disappeared after a sync
  const selectedIds = useMemo(
    () => (files ?? []).filter(f => selected.has(f.id)).map(f => f.id),
    [files, selected]
  )
  const selectedSources = (files ?? []).filter(f => selected.has(f.id) && f.source_id).length

  const toggle = (id: string, on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const runBulk = (action: SyncedFileBulkAction) =>
    bulk.mutate(
      { fileIds: selectedIds, action },
      {
        onSuccess: () => {
          setSelected(new Set())
          setConfirmDelete(false)
        },
      }
    )

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <LoadingSpinner />
      </div>
    )
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        {getApiErrorMessage(error, t, 'integrations.filesLoadFailed')}
      </p>
    )
  }

  if (!files || files.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('integrations.noFiles')}</p>
  }

  const allSelected = selectedIds.length === files.length

  return (
    <>
      <p className="mb-2 text-xs text-muted-foreground">{t('integrations.fileSyncHint')}</p>
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <Checkbox
            id={`files-select-all-${linkId}`}
            checked={allSelected ? true : selectedIds.length > 0 ? 'indeterminate' : false}
            onCheckedChange={v =>
              setSelected(v === true ? new Set(files.map(f => f.id)) : new Set())
            }
          />
          <Label htmlFor={`files-select-all-${linkId}`} className="text-xs font-normal">
            {selectedIds.length > 0
              ? t('integrations.filesSelected', { count: selectedIds.length })
              : t('integrations.selectAllFiles')}
          </Label>
        </span>
        {selectedIds.length > 0 && (
          <span className="ml-auto flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={bulk.isPending}
              onClick={() => runBulk('stop_sync')}
            >
              <Pause className="h-3.5 w-3.5" />
              {t('integrations.bulkStopSync')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={bulk.isPending}
              onClick={() => runBulk('resume_sync')}
            >
              <Play className="h-3.5 w-3.5" />
              {t('integrations.bulkResumeSync')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={bulk.isPending}
              onClick={() => runBulk('disconnect')}
              title={t('integrations.bulkDisconnectHint')}
            >
              <Unplug className="h-3.5 w-3.5" />
              {t('integrations.bulkDisconnect')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={bulk.isPending}
              onClick={() => runBulk('include')}
            >
              <Undo2 className="h-3.5 w-3.5" />
              {t('integrations.includeFile')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              disabled={bulk.isPending}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('integrations.bulkDelete')}
            </Button>
          </span>
        )}
      </div>
      <ul className="divide-y rounded-md border">
        {files.map(file => {
          const excluded = file.status === 'excluded'
          const toggleId = `file-sync-${file.id}`
          return (
            <li
              key={file.id}
              className="flex flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:gap-3"
            >
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <Checkbox
                  checked={selected.has(file.id)}
                  onCheckedChange={v => toggle(file.id, v === true)}
                  aria-label={t('integrations.selectFile', { name: file.name })}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate" title={file.path ?? file.name}>
                    {file.name}
                  </p>
                  {file.path && (
                    <p className="text-xs text-muted-foreground truncate font-mono">{file.path}</p>
                  )}
                  {file.last_error && (
                    <p className="text-xs text-destructive break-words">{file.last_error}</p>
                  )}
                  {file.status === 'ignored' && (
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.fileIgnoredHint')}
                    </p>
                  )}
                  {excluded && (
                    <p className="text-xs text-muted-foreground">
                      {t('integrations.fileExcludedHint')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap shrink-0 text-xs text-muted-foreground">
                <FileStatusBadge status={file.status} />
                <RelativeTime value={file.remote_modified_at} fallback="" />
                {!excluded && (
                  <span className="inline-flex items-center gap-1.5">
                    <Checkbox
                      id={toggleId}
                      checked={file.sync_enabled}
                      disabled={updateFile.isPending}
                      onCheckedChange={v =>
                        updateFile.mutate({
                          id: file.id,
                          syncEnabled: v === true,
                        })
                      }
                    />
                    <Label htmlFor={toggleId} className="text-xs font-normal">
                      {t('integrations.fileSyncToggle')}
                    </Label>
                  </span>
                )}
                {file.source_id && (
                  <Link
                    href={sourceHref(file.source_id)}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {t('integrations.openSource')}
                  </Link>
                )}
                {file.web_url && (
                  <a
                    href={file.web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {t(openInProviderKey(provider))}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {excluded ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => includeFile.mutate(file.id)}
                    disabled={includeFile.isPending}
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    {t('integrations.includeFile')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => setFileToExclude(file)}
                  >
                    <Ban className="h-3.5 w-3.5" />
                    {t('integrations.excludeFile')}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('integrations.bulkDeleteTitle')}
        description={t('integrations.bulkDeleteConfirm', {
          count: selectedIds.length,
          sources: selectedSources,
        })}
        confirmText={t('integrations.bulkDelete')}
        confirmVariant="destructive"
        onConfirm={() => runBulk('delete')}
        isLoading={bulk.isPending}
      />

      {fileToExclude && (
        <ExcludeFileDialog
          file={fileToExclude}
          open={!!fileToExclude}
          onOpenChange={open => {
            if (!open) setFileToExclude(null)
          }}
        />
      )}
    </>
  )
}
