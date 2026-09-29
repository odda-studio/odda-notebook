'use client'

import { useEffect, useId, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useDeleteTransformationGroup } from '@/lib/hooks/use-transformations'
import { TransformationGroup } from '@/lib/types/transformations'
import { useTranslation } from '@/lib/hooks/use-translation'

type DeleteMode = 'keep' | 'delete'

interface DeleteTransformationGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  group?: TransformationGroup
  /** Number of transformations currently in the group. */
  transformationCount: number
}

export function DeleteTransformationGroupDialog({
  open,
  onOpenChange,
  group,
  transformationCount,
}: DeleteTransformationGroupDialogProps) {
  const { t } = useTranslation()
  const keepId = useId()
  const deleteId = useId()
  // Ask every time: always start from the safe choice.
  const [mode, setMode] = useState<DeleteMode>('keep')
  const deleteGroup = useDeleteTransformationGroup()

  useEffect(() => {
    if (open) setMode('keep')
  }, [open])

  const handleConfirm = async () => {
    if (!group) return
    try {
      await deleteGroup.mutateAsync({ id: group.id, deleteTransformations: mode === 'delete' })
      onOpenChange(false)
    } catch {
      // Error toast is shown by the mutation hook.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('transformations.deleteGroup')}</DialogTitle>
          <DialogDescription>
            {t('transformations.deleteGroupDesc', { name: group?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>

        {transformationCount > 0 && (
          <RadioGroup value={mode} onValueChange={(value) => setMode(value as DeleteMode)}>
            <div className="flex items-start gap-3 rounded-md border p-3">
              <RadioGroupItem value="keep" id={keepId} className="mt-0.5" />
              <Label htmlFor={keepId} className="flex flex-col items-start gap-1 font-normal">
                <span className="font-medium">{t('transformations.deleteGroupKeep')}</span>
                <span className="text-xs text-muted-foreground">
                  {t('transformations.deleteGroupKeepDesc')}
                </span>
              </Label>
            </div>
            <div className="flex items-start gap-3 rounded-md border border-destructive/40 p-3">
              <RadioGroupItem value="delete" id={deleteId} className="mt-0.5" />
              <Label htmlFor={deleteId} className="flex flex-col items-start gap-1 font-normal">
                <span className="font-medium text-destructive">
                  {t('transformations.deleteGroupAlsoTransformations', { count: transformationCount })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('transformations.deleteGroupAlsoTransformationsDesc')}
                </span>
              </Label>
            </div>
          </RadioGroup>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={deleteGroup.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleteGroup.isPending || !group}
          >
            {t('common.delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
