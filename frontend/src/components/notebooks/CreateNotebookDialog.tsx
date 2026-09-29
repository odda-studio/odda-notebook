'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useCreateNotebook } from '@/lib/hooks/use-notebooks'
import { useTransformations, useTransformationGroups } from '@/lib/hooks/use-transformations'
import { GroupedTransformationPicker } from '@/components/transformations/GroupedTransformationPicker'
import { useTranslation } from '@/lib/hooks/use-translation'

const createNotebookSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
})

type CreateNotebookFormData = z.infer<typeof createNotebookSchema>

interface CreateNotebookDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateNotebookDialog({ open, onOpenChange }: CreateNotebookDialogProps) {
  const { t } = useTranslation()
  const createNotebook = useCreateNotebook()
  const { data: transformations = [], isLoading: transformationsLoading } = useTransformations()
  const { data: transformationGroups } = useTransformationGroups()
  const [defaultTransformations, setDefaultTransformations] = useState<string[]>([])
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    reset,
  } = useForm<CreateNotebookFormData>({
    resolver: zodResolver(createNotebookSchema),
    mode: 'onChange',
    defaultValues: {
      name: '',
      description: '',
    },
  })

  const closeDialog = () => onOpenChange(false)

  const onSubmit = async (data: CreateNotebookFormData) => {
    await createNotebook.mutateAsync({ ...data, default_transformations: defaultTransformations })
    closeDialog()
    reset()
    setDefaultTransformations([])
  }

  useEffect(() => {
    if (!open) {
      reset()
      setDefaultTransformations([])
    }
  }, [open, reset])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('notebooks.createNew')}</DialogTitle>
          <DialogDescription>
            {t('notebooks.createNewDesc')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notebook-name">{t('common.name')} *</Label>
            <Input
              id="notebook-name"
              {...register('name')}
              placeholder={t('notebooks.namePlaceholder')}
              autoComplete="off"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notebook-description">{t('common.description')}</Label>
            <Textarea
              id="notebook-description"
              {...register('description')}
              placeholder={t('notebooks.descPlaceholder')}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('notebooks.defaultTransformations')}</Label>
            <p className="text-xs text-muted-foreground">
              {t('notebooks.defaultTransformationsDesc')}
            </p>
            <GroupedTransformationPicker
              transformations={transformations}
              groups={transformationGroups}
              selectedIds={defaultTransformations}
              onChange={setDefaultTransformations}
              loading={transformationsLoading}
              emptyMessage={t('notebooks.noTransformationsAvailable')}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={closeDialog}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!isValid || createNotebook.isPending}>
              {createNotebook.isPending ? t('common.creating') : t('notebooks.createNew')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
