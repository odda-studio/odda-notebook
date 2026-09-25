'use client'

import { useEffect } from 'react'
import { Info } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useIntegrationSettings } from '@/lib/hooks/use-integrations'
import type { ImportLinksRequest } from '@/lib/api/integrations'
import {
  CloudPicker,
  CloudPickerValue,
  isCloudSelectionValid,
  selectionHasFolder,
} from './CloudPicker'
import { areLinkFieldsValid, intervalPayload, LinkFields, LinkFieldValues } from './LinkFields'

interface CloudImportPanelProps {
  selection: CloudPickerValue
  onSelectionChange: (value: CloudPickerValue) => void
  options: LinkFieldValues
  onOptionsChange: (values: LinkFieldValues) => void
  idPrefix: string
  /** Hidden when the host (Add Source dialog) has its own notebooks step. */
  showNotebooks?: boolean
  /** Hidden when the host has its own transformations step. */
  showTransformations?: boolean
}

/** Picker + import options, shared by Settings → Integrations and Add Source. */
export function CloudImportPanel({
  selection,
  onSelectionChange,
  options,
  onOptionsChange,
  idPrefix,
  showNotebooks = true,
  showTransformations = true,
}: CloudImportPanelProps) {
  const { t } = useTranslation()
  const { data: settings } = useIntegrationSettings()
  const defaultInterval = settings?.default_interval_minutes

  // Fill the default interval once settings arrive, if the user hasn't typed one
  useEffect(() => {
    if (defaultInterval && options.interval_minutes === '') {
      onOptionsChange({ ...options, interval_minutes: String(defaultInterval) })
    }
    // Only react to the settings arriving
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultInterval])

  return (
    <div className="space-y-5">
      <CloudPicker value={selection} onChange={onSelectionChange} idPrefix={`${idPrefix}-picker`} />

      {!!selection.accountId && (
        <>
          <LinkFields
            values={options}
            onChange={onOptionsChange}
            idPrefix={idPrefix}
            showNotebooks={showNotebooks}
            showRecursive={selectionHasFolder(selection)}
            showTransformations={showTransformations}
            allowEmptyInterval
          />
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {t('integrations.syncSemantics')}
          </p>
        </>
      )}
    </div>
  )
}

export function isCloudImportValid(selection: CloudPickerValue, options: LinkFieldValues): boolean {
  return isCloudSelectionValid(selection) && areLinkFieldsValid(options, true)
}

/** Builds the POST /links/import body. */
export function buildImportRequest(
  selection: CloudPickerValue,
  options: LinkFieldValues,
  notebookIds: string[],
  transformations: string[]
): ImportLinksRequest {
  const request: ImportLinksRequest = {
    account_id: selection.accountId,
    items: selection.items,
    notebook_ids: notebookIds,
    sync_enabled: options.sync_enabled,
    recursive: options.recursive,
    transformations,
  }
  const interval = intervalPayload(options)
  if (interval !== undefined) request.interval_minutes = interval
  return request
}
