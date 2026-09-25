'use client'

import { useEffect } from 'react'
import { Control, Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useUpdateIntegrationSettings } from '@/lib/hooks/use-integrations'
import type {
  IntegrationSettings,
  UpdateIntegrationSettingsRequest,
} from '@/lib/api/integrations'
import { formatExtensions, parseExtensions } from './integration-utils'
import { MIN_SYNC_INTERVAL_MINUTES } from './LinkFields'

const MAX_FILE_MB_MIN = 1
const MAX_FILE_MB_MAX = 1024

const DOCUMENT_FORMATS = ['docx', 'pdf', 'md', 'txt'] as const
const SPREADSHEET_FORMATS = ['xlsx', 'csv', 'pdf'] as const
const PRESENTATION_FORMATS = ['pptx', 'pdf'] as const

const isIntInRange = (value: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
  if (value.trim() === '') return false
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max
}

// Error messages are i18n keys, translated when rendered
const syncSettingsSchema = z.object({
  public_url: z
    .string()
    .trim()
    .refine(v => v === '' || /^https?:\/\/[^\s]+$/i.test(v), {
      message: 'integrations.publicUrlInvalid',
    }),
  scheduler_enabled: z.boolean(),
  default_interval_minutes: z
    .string()
    .refine(v => isIntInRange(v, MIN_SYNC_INTERVAL_MINUTES), {
      message: 'integrations.intervalMin',
    }),
  max_file_mb: z
    .string()
    .refine(v => isIntInRange(v, MAX_FILE_MB_MIN, MAX_FILE_MB_MAX), {
      message: 'integrations.maxFileMbRange',
    }),
  allowed_extensions: z.string(),
  document: z.enum(DOCUMENT_FORMATS),
  spreadsheet: z.enum(SPREADSHEET_FORMATS),
  presentation: z.enum(PRESENTATION_FORMATS),
})

type SyncSettingsFormData = z.infer<typeof syncSettingsSchema>

function toFormData(settings: IntegrationSettings): SyncSettingsFormData {
  return {
    public_url: settings.public_url ?? '',
    scheduler_enabled: settings.scheduler_enabled,
    default_interval_minutes: String(settings.default_interval_minutes),
    max_file_mb: String(settings.max_file_mb),
    allowed_extensions: formatExtensions(settings.allowed_extensions),
    document: settings.google_export_formats.document,
    spreadsheet: settings.google_export_formats.spreadsheet,
    presentation: settings.google_export_formats.presentation,
  }
}

/** Builds the PUT body, leaving out env-managed / forced fields. */
export function buildSettingsPayload(
  data: SyncSettingsFormData,
  settings: IntegrationSettings
): UpdateIntegrationSettingsRequest {
  const payload: UpdateIntegrationSettingsRequest = {
    default_interval_minutes: Number(data.default_interval_minutes),
    max_file_mb: Number(data.max_file_mb),
    allowed_extensions: parseExtensions(data.allowed_extensions),
    google_export_formats: {
      document: data.document,
      spreadsheet: data.spreadsheet,
      presentation: data.presentation,
    },
  }
  if (settings.public_url_source !== 'env') {
    const url = data.public_url.trim().replace(/\/+$/, '')
    payload.public_url = url === '' ? null : url
  }
  if (!settings.scheduler_forced_off) {
    payload.scheduler_enabled = data.scheduler_enabled
  }
  return payload
}

interface SyncSettingsFormProps {
  settings: IntegrationSettings
}

export function SyncSettingsForm({ settings }: SyncSettingsFormProps) {
  const { t } = useTranslation()
  const updateSettings = useUpdateIntegrationSettings()

  const publicUrlFromEnv = settings.public_url_source === 'env'
  const schedulerForcedOff = settings.scheduler_forced_off

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<SyncSettingsFormData>({
    resolver: zodResolver(syncSettingsSchema),
    defaultValues: toFormData(settings),
  })

  // Keep the form in sync with the server copy (initial load / after save)
  useEffect(() => {
    reset(toFormData(settings))
  }, [settings, reset])

  const onSubmit = (data: SyncSettingsFormData) => {
    updateSettings.mutate(buildSettingsPayload(data, settings))
  }

  const errorText = (message?: string) =>
    message
      ? t(message, {
          min: message === 'integrations.maxFileMbRange' ? MAX_FILE_MB_MIN : MIN_SYNC_INTERVAL_MINUTES,
          max: MAX_FILE_MB_MAX,
        })
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('integrations.syncSettingsTitle')}</CardTitle>
        <CardDescription>{t('integrations.syncSettingsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
          {/* Public URL */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="integrations-public-url">{t('integrations.publicUrl')}</Label>
              {publicUrlFromEnv && (
                <Badge variant="secondary">{t('integrations.managedByEnv')}</Badge>
              )}
            </div>
            <Input
              id="integrations-public-url"
              placeholder={t('integrations.publicUrlPlaceholder')}
              readOnly={publicUrlFromEnv}
              disabled={publicUrlFromEnv}
              aria-invalid={!!errors.public_url}
              {...register('public_url')}
            />
            <p className="text-xs text-muted-foreground">{t('integrations.publicUrlHint')}</p>
            {errors.public_url && (
              <p className="text-xs text-destructive">{errorText(errors.public_url.message)}</p>
            )}
          </div>

          {/* Scheduler */}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Controller
                name="scheduler_enabled"
                control={control}
                render={({ field }) => (
                  <Checkbox
                    id="integrations-scheduler"
                    checked={schedulerForcedOff ? false : field.value}
                    onCheckedChange={v => field.onChange(v === true)}
                    disabled={schedulerForcedOff}
                  />
                )}
              />
              <Label htmlFor="integrations-scheduler">{t('integrations.schedulerEnabled')}</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              {schedulerForcedOff
                ? t('integrations.schedulerForcedOff')
                : t('integrations.schedulerHint')}
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2">
            {/* Default interval */}
            <div className="space-y-2">
              <Label htmlFor="integrations-default-interval">
                {t('integrations.defaultInterval')}
              </Label>
              <Input
                id="integrations-default-interval"
                type="number"
                min={MIN_SYNC_INTERVAL_MINUTES}
                step={1}
                aria-invalid={!!errors.default_interval_minutes}
                {...register('default_interval_minutes')}
              />
              {errors.default_interval_minutes && (
                <p className="text-xs text-destructive">
                  {errorText(errors.default_interval_minutes.message)}
                </p>
              )}
            </div>

            {/* Max file size */}
            <div className="space-y-2">
              <Label htmlFor="integrations-max-file-mb">{t('integrations.maxFileMb')}</Label>
              <Input
                id="integrations-max-file-mb"
                type="number"
                min={MAX_FILE_MB_MIN}
                max={MAX_FILE_MB_MAX}
                step={1}
                aria-invalid={!!errors.max_file_mb}
                {...register('max_file_mb')}
              />
              {errors.max_file_mb && (
                <p className="text-xs text-destructive">{errorText(errors.max_file_mb.message)}</p>
              )}
            </div>
          </div>

          {/* Extensions */}
          <div className="space-y-2">
            <Label htmlFor="integrations-extensions">{t('integrations.allowedExtensions')}</Label>
            <Input
              id="integrations-extensions"
              placeholder={t('integrations.allowedExtensionsPlaceholder')}
              {...register('allowed_extensions')}
            />
            <p className="text-xs text-muted-foreground">
              {t('integrations.allowedExtensionsHint')}
            </p>
          </div>

          {/* Google export formats */}
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">{t('integrations.googleExportFormats')}</h3>
              <p className="text-xs text-muted-foreground">
                {t('integrations.googleExportFormatsHint')}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormatSelect
                control={control}
                name="document"
                label={t('integrations.googleDocs')}
                options={DOCUMENT_FORMATS}
              />
              <FormatSelect
                control={control}
                name="spreadsheet"
                label={t('integrations.googleSheets')}
                options={SPREADSHEET_FORMATS}
              />
              <FormatSelect
                control={control}
                name="presentation"
                label={t('integrations.googleSlides')}
                options={PRESENTATION_FORMATS}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={!isDirty || updateSettings.isPending}>
              {updateSettings.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function FormatSelect({
  control,
  name,
  label,
  options,
}: {
  control: Control<SyncSettingsFormData>
  name: 'document' | 'spreadsheet' | 'presentation'
  label: string
  options: readonly string[]
}) {
  const id = `integrations-export-${name}`
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map(option => (
                <SelectItem key={option} value={option}>
                  {option.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </div>
  )
}
