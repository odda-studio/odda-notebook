'use client'

import { FormEvent, useEffect, useId, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  useCreateTransformationGroup,
  useUpdateTransformationGroup,
} from '@/lib/hooks/use-transformations'
import { TransformationGroup } from '@/lib/types/transformations'
import { useTranslation } from '@/lib/hooks/use-translation'

const MAX_GROUP_NAME_LENGTH = 100

interface TransformationGroupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set the dialog renames this group, otherwise it creates one. */
  group?: TransformationGroup
}

export function TransformationGroupDialog({ open, onOpenChange, group }: TransformationGroupDialogProps) {
  const { t } = useTranslation()
  const nameId = useId()
  const [name, setName] = useState('')
  const createGroup = useCreateTransformationGroup()
  const updateGroup = useUpdateTransformationGroup()
  const isEditing = Boolean(group)
  const isSaving = isEditing ? updateGroup.isPending : createGroup.isPending

  useEffect(() => {
    if (open) {
      setName(group?.name ?? '')
    }
  }, [open, group])

  const trimmed = name.trim()

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!trimmed) return
    try {
      if (group) {
        await updateGroup.mutateAsync({ id: group.id, data: { name: trimmed } })
      } else {
        await createGroup.mutateAsync({ name: trimmed })
      }
      onOpenChange(false)
    } catch {
      // Error toast is shown by the mutation hook; keep the dialog open.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? t('transformations.renameGroup') : t('transformations.newGroup')}
            </DialogTitle>
            <DialogDescription>{t('transformations.groupDialogDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={nameId}>{t('transformations.groupName')}</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('transformations.groupNamePlaceholder')}
              maxLength={MAX_GROUP_NAME_LENGTH}
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!trimmed || isSaving}>
              {isEditing ? t('common.save') : t('transformations.newGroup')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
