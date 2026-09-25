'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useExcludeSyncedFile } from '@/lib/hooks/use-integrations'
import type { SyncedFile } from '@/lib/api/integrations'

interface ExcludeFileDialogProps {
  file: SyncedFile
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Confirms excluding a file from its folder link, optionally deleting its source. */
export function ExcludeFileDialog({ file, open, onOpenChange }: ExcludeFileDialogProps) {
  const { t } = useTranslation()
  const excludeFile = useExcludeSyncedFile()
  const [deleteSource, setDeleteSource] = useState(false)

  const handleConfirm = () =>
    excludeFile.mutate(
      { id: file.id, deleteSource: !!file.source_id && deleteSource },
      { onSuccess: () => onOpenChange(false) }
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('integrations.excludeFileTitle')}</DialogTitle>
          <DialogDescription>
            {t('integrations.excludeFileConfirm', { name: file.name })}
          </DialogDescription>
        </DialogHeader>

        {file.source_id && (
          <div className="flex items-start gap-2">
            <Checkbox
              id={`exclude-delete-${file.id}`}
              checked={deleteSource}
              onCheckedChange={v => setDeleteSource(v === true)}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor={`exclude-delete-${file.id}`}>{t('integrations.excludeDeleteSource')}</Label>
              <p className="text-xs text-muted-foreground">
                {deleteSource
                  ? t('integrations.excludeDeleteSourceHint')
                  : t('integrations.excludeKeepSourceHint')}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={excludeFile.isPending}
          >
            {excludeFile.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('integrations.excludeFile')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
