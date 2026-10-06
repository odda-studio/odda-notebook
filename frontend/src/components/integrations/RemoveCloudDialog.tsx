'use client'

import { useEffect, useState } from 'react'
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

interface RemoveCloudDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmText: string
  /** Label of the "also delete the sources" checkbox; hidden when omitted. */
  deleteLabel?: string
  onConfirm: (deleteSources: boolean) => void
  isLoading?: boolean
}

/**
 * Confirms stopping cloud sync for a link, an account or a source, with the
 * choice of keeping the imported sources as regular ones or deleting them.
 */
export function RemoveCloudDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  deleteLabel,
  onConfirm,
  isLoading = false,
}: RemoveCloudDialogProps) {
  const { t } = useTranslation()
  const [deleteSources, setDeleteSources] = useState(false)

  // Dialogs don't reset their state: start from "keep" every time
  useEffect(() => {
    if (open) setDeleteSources(false)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {deleteLabel && (
          <div className="flex items-start gap-2">
            <Checkbox
              id="remove-cloud-delete-sources"
              checked={deleteSources}
              onCheckedChange={v => setDeleteSources(v === true)}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="remove-cloud-delete-sources">{deleteLabel}</Label>
              <p className="text-xs text-muted-foreground">
                {deleteSources
                  ? t('integrations.removeDeleteSourcesHint')
                  : t('integrations.removeKeepSourcesHint')}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => onConfirm(deleteSources)}
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
