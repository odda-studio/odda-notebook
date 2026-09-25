'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useUpdateLink } from '@/lib/hooks/use-integrations'
import type { SyncLink, UpdateLinkRequest } from '@/lib/api/integrations'
import { areLinkFieldsValid, intervalPayload, LinkFields, LinkFieldValues } from './LinkFields'

interface LinkEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  link: SyncLink
}

function toFieldValues(link: SyncLink): LinkFieldValues {
  return {
    notebook_ids: link.notebook_ids,
    recursive: link.recursive,
    interval_minutes: String(link.interval_minutes),
    transformations: link.transformations,
    sync_enabled: link.sync_enabled,
  }
}

export function LinkEditDialog({ open, onOpenChange, link }: LinkEditDialogProps) {
  const { t } = useTranslation()
  const updateLink = useUpdateLink()
  const [fields, setFields] = useState<LinkFieldValues>(() => toFieldValues(link))

  // Re-seed on open only: the list polls while syncing, and a refetch must
  // not overwrite what the user is editing.
  useEffect(() => {
    if (open) setFields(toFieldValues(link))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only fires on open
  }, [open])

  const knownNotebookNames = useMemo(() => {
    const names: Record<string, string> = {}
    link.notebook_ids.forEach((id, i) => {
      if (link.notebook_names[i]) names[id] = link.notebook_names[i]
    })
    return names
  }, [link.notebook_ids, link.notebook_names])

  const isFolder = link.kind === 'folder'
  const canSubmit = areLinkFieldsValid(fields) && !updateLink.isPending

  const handleSubmit = () => {
    if (!canSubmit) return
    const data: UpdateLinkRequest = {
      notebook_ids: fields.notebook_ids,
      transformations: fields.transformations,
      sync_enabled: fields.sync_enabled,
    }
    if (isFolder) data.recursive = fields.recursive
    const interval = intervalPayload(fields)
    if (interval !== undefined) data.interval_minutes = interval
    updateLink.mutate({ id: link.id, data }, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('integrations.editLinkTitle')}</DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">
            {link.account_name} · {link.remote_path}
          </DialogDescription>
        </DialogHeader>

        <LinkFields
          values={fields}
          onChange={setFields}
          idPrefix={`edit-link-${link.id}`}
          showRecursive={isFolder}
          knownNotebookNames={knownNotebookNames}
        />
        <p className="text-xs text-muted-foreground">{t('integrations.editNotebooksHint')}</p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {updateLink.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
