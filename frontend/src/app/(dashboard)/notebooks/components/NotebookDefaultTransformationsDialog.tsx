'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { GroupedTransformationPicker } from '@/components/transformations/GroupedTransformationPicker'
import { useTransformations, useTransformationGroups } from '@/lib/hooks/use-transformations'
import { useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { useTranslation } from '@/lib/hooks/use-translation'
import { NotebookResponse } from '@/lib/types/api'

interface NotebookDefaultTransformationsDialogProps {
  notebook: NotebookResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Edit the transformations that run on every source added to a notebook.
 */
export function NotebookDefaultTransformationsDialog({
  notebook,
  open,
  onOpenChange,
}: NotebookDefaultTransformationsDialogProps) {
  const { t } = useTranslation()
  const { data: transformations = [], isLoading } = useTransformations()
  const { data: groups } = useTransformationGroups()
  const updateNotebook = useUpdateNotebook()
  const [selected, setSelected] = useState<string[]>(notebook.default_transformations ?? [])

  // Start from the saved defaults every time the dialog opens
  useEffect(() => {
    if (open) {
      setSelected(notebook.default_transformations ?? [])
    }
  }, [open, notebook.default_transformations])

  const handleSave = async () => {
    // Drop ids of transformations that no longer exist (the API rejects them)
    const known = new Set(transformations.map((transformation) => transformation.id))
    const ids = isLoading ? selected : selected.filter((id) => known.has(id))
    try {
      await updateNotebook.mutateAsync({
        id: notebook.id,
        data: { default_transformations: ids },
      })
      onOpenChange(false)
    } catch {
      // Error toast is shown by the mutation hook
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('notebooks.defaultTransformations')}</DialogTitle>
          <DialogDescription>{t('notebooks.defaultTransformationsDesc')}</DialogDescription>
        </DialogHeader>

        <GroupedTransformationPicker
          transformations={transformations}
          groups={groups}
          selectedIds={selected}
          onChange={setSelected}
          loading={isLoading}
          emptyMessage={t('notebooks.noTransformationsAvailable')}
        />

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={updateNotebook.isPending}>
            {updateNotebook.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
