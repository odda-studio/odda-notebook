'use client'

import { useMemo } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { CheckboxList } from '@/components/ui/checkbox-list'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useNotebooks } from '@/lib/hooks/use-notebooks'
import { useTransformations, useTransformationGroups } from '@/lib/hooks/use-transformations'
import { GroupedTransformationPicker } from '@/components/transformations/GroupedTransformationPicker'

/** Minimum per-link sync interval accepted by the backend. */
export const MIN_SYNC_INTERVAL_MINUTES = 5

export interface LinkFieldValues {
  /** Empty = general sources only. */
  notebook_ids: string[]
  recursive: boolean
  /** Kept as a string while editing so the input can be cleared. */
  interval_minutes: string
  transformations: string[]
  sync_enabled: boolean
}

export function emptyLinkFieldValues(defaultInterval?: number): LinkFieldValues {
  return {
    notebook_ids: [],
    recursive: true,
    interval_minutes: defaultInterval ? String(defaultInterval) : '',
    transformations: [],
    sync_enabled: true,
  }
}

/**
 * @param allowEmpty when true an empty value is valid (the backend then uses
 *   settings.default_interval_minutes).
 */
export function isValidInterval(value: string, allowEmpty = false): boolean {
  if (value.trim() === '') return allowEmpty
  const n = Number(value)
  return Number.isInteger(n) && n >= MIN_SYNC_INTERVAL_MINUTES
}

/**
 * The interval only matters while sync is on: with sync off an invalid or
 * empty value is simply not sent.
 */
export function areLinkFieldsValid(values: LinkFieldValues, allowEmptyInterval = false): boolean {
  return !values.sync_enabled || isValidInterval(values.interval_minutes, allowEmptyInterval)
}

/** interval_minutes for the API, or undefined to keep / use the default. */
export function intervalPayload(values: LinkFieldValues): number | undefined {
  return isValidInterval(values.interval_minutes) ? Number(values.interval_minutes) : undefined
}

interface LinkFieldsProps {
  values: LinkFieldValues
  onChange: (values: LinkFieldValues) => void
  idPrefix: string
  /** Notebook multi-select (hidden when the host dialog has its own step). */
  showNotebooks?: boolean
  /** Only meaningful for folders. */
  showRecursive?: boolean
  showTransformations?: boolean
  /** Allow an empty interval (= server default). */
  allowEmptyInterval?: boolean
  /** Names for notebook ids that are not in the (non-archived) list. */
  knownNotebookNames?: Record<string, string>
}

export function LinkFields({
  values,
  onChange,
  idPrefix,
  showNotebooks = true,
  showRecursive = true,
  showTransformations = true,
  allowEmptyInterval = false,
  knownNotebookNames,
}: LinkFieldsProps) {
  const { t } = useTranslation()
  const { data: notebooks, isLoading: notebooksLoading } = useNotebooks(false)
  const { data: transformations, isLoading: transformationsLoading } = useTransformations()
  const { data: transformationGroups } = useTransformationGroups()

  const notebookItems = useMemo(() => {
    const items = (notebooks ?? []).map(nb => ({ id: nb.id, title: nb.name }))
    for (const id of values.notebook_ids) {
      if (!items.some(i => i.id === id)) {
        items.unshift({ id, title: knownNotebookNames?.[id] || id })
      }
    }
    return items
  }, [notebooks, values.notebook_ids, knownNotebookNames])

  const set = <K extends keyof LinkFieldValues>(key: K, value: LinkFieldValues[K]) =>
    onChange({ ...values, [key]: value })

  const toggle = (key: 'notebook_ids', id: string) =>
    set(key, values[key].includes(id) ? values[key].filter(x => x !== id) : [...values[key], id])

  const intervalInvalid =
    values.sync_enabled &&
    values.interval_minutes !== '' &&
    !isValidInterval(values.interval_minutes, allowEmptyInterval)

  return (
    <div className="space-y-4">
      {showNotebooks && (
        <div className="space-y-2">
          <Label>{t('integrations.notebooks')}</Label>
          <p className="text-xs text-muted-foreground">{t('integrations.notebooksHint')}</p>
          <CheckboxList
            items={notebookItems}
            selectedIds={values.notebook_ids}
            onToggle={id => toggle('notebook_ids', id)}
            loading={notebooksLoading}
            emptyMessage={t('integrations.noNotebooks')}
          />
        </div>
      )}

      <div className="flex items-start gap-2">
        <Checkbox
          id={`${idPrefix}-sync-enabled`}
          checked={values.sync_enabled}
          onCheckedChange={v => set('sync_enabled', v === true)}
          className="mt-0.5"
        />
        <div>
          <Label htmlFor={`${idPrefix}-sync-enabled`}>{t('integrations.keepInSync')}</Label>
          <p className="text-xs text-muted-foreground">
            {values.sync_enabled
              ? t('integrations.keepInSyncOnHint')
              : t('integrations.keepInSyncOffHint')}
          </p>
        </div>
      </div>

      {showRecursive && (
        <div className="flex items-start gap-2">
          <Checkbox
            id={`${idPrefix}-recursive`}
            checked={values.recursive}
            onCheckedChange={v => set('recursive', v === true)}
            className="mt-0.5"
          />
          <div>
            <Label htmlFor={`${idPrefix}-recursive`}>{t('integrations.recursive')}</Label>
            <p className="text-xs text-muted-foreground">{t('integrations.recursiveHint')}</p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-interval`}>{t('integrations.intervalMinutes')}</Label>
        <Input
          id={`${idPrefix}-interval`}
          type="number"
          min={MIN_SYNC_INTERVAL_MINUTES}
          step={1}
          value={values.interval_minutes}
          onChange={e => set('interval_minutes', e.target.value)}
          aria-invalid={intervalInvalid}
          disabled={!values.sync_enabled}
        />
        {intervalInvalid && (
          <p className="text-xs text-destructive">
            {t('integrations.intervalMin', { min: MIN_SYNC_INTERVAL_MINUTES })}
          </p>
        )}
      </div>

      {showTransformations && (
        <div className="space-y-2">
          <Label>{t('integrations.transformations')}</Label>
          <p className="text-xs text-muted-foreground">{t('integrations.transformationsHint')}</p>
          <GroupedTransformationPicker
            transformations={transformations ?? []}
            groups={transformationGroups}
            selectedIds={values.transformations}
            onChange={ids => set('transformations', ids)}
            loading={transformationsLoading}
            emptyMessage={t('integrations.noTransformations')}
          />
        </div>
      )}
    </div>
  )
}
