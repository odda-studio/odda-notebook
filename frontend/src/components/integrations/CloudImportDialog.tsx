'use client'

import { useState } from 'react'
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
import { useImportLinks } from '@/lib/hooks/use-integrations'
import { CloudPickerValue, EMPTY_CLOUD_PICKER_VALUE } from './CloudPicker'
import { buildImportRequest, CloudImportPanel, isCloudImportValid } from './CloudImportPanel'
import { emptyLinkFieldValues, LinkFieldValues } from './LinkFields'

interface CloudImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselected notebooks (e.g. the current notebook). */
  defaultNotebookIds?: string[]
}

/**
 * Standalone import dialog (Settings → Integrations). Mount it only while
 * open so its state starts fresh each time.
 */
export function CloudImportDialog({ open, onOpenChange, defaultNotebookIds }: CloudImportDialogProps) {
  const { t } = useTranslation()
  const importLinks = useImportLinks()
  const [selection, setSelection] = useState<CloudPickerValue>(EMPTY_CLOUD_PICKER_VALUE)
  const [options, setOptions] = useState<LinkFieldValues>(() => ({
    ...emptyLinkFieldValues(),
    notebook_ids: defaultNotebookIds ?? [],
  }))

  const canSubmit = isCloudImportValid(selection, options) && !importLinks.isPending

  const handleSubmit = () => {
    if (!canSubmit) return
    importLinks.mutate(
      buildImportRequest(selection, options, options.notebook_ids, options.transformations),
      { onSuccess: () => onOpenChange(false) }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('integrations.importTitle')}</DialogTitle>
          <DialogDescription>{t('integrations.importDescription')}</DialogDescription>
        </DialogHeader>

        <CloudImportPanel
          selection={selection}
          onSelectionChange={setSelection}
          options={options}
          onOptionsChange={setOptions}
          idPrefix="import-dialog"
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {importLinks.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('integrations.importSubmit', { count: selection.items.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
