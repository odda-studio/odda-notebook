'use client'

import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, ArrowLeft, Check, Copy, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import {
  useCreateWidgetKey,
  useDeleteWidgetKey,
  useRegenerateWidgetKey,
  useUpdateWidgetKey,
  useWidgetKeys,
} from '@/lib/hooks/use-widget-keys'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useToast } from '@/lib/hooks/use-toast'
import { getApiUrl } from '@/lib/config'
import { getDateLocale } from '@/lib/utils/date-locale'
import {
  PLACEHOLDER_WIDGET_KEY,
  buildEmbedSnippet,
  parseOrigins,
} from '@/lib/utils/widget'
import { NotebookResponse } from '@/lib/types/api'
import { WidgetKey, WidgetKeyCreated } from '@/lib/api/widget-keys'

interface NotebookWidgetDialogProps {
  notebook: NotebookResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DEFAULT_RATE_LIMIT = 20

function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: t('common.error'), description: t('widget.copyFailed'), variant: 'destructive' })
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
      {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
      {copied ? t('widget.copied') : label}
    </Button>
  )
}

interface KeyFormProps {
  initial: WidgetKey | null
  isPending: boolean
  onCancel: () => void
  onSubmit: (values: {
    name: string
    allowed_origins: string[]
    rate_limit_per_minute: number
    daily_limit: number
  }) => void
}

function KeyForm({ initial, isPending, onCancel, onSubmit }: KeyFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [originsText, setOriginsText] = useState((initial?.allowed_origins ?? []).join('\n'))
  const [rate, setRate] = useState(String(initial?.rate_limit_per_minute ?? DEFAULT_RATE_LIMIT))
  const [daily, setDaily] = useState(String(initial?.daily_limit ?? 0))
  const [submitted, setSubmitted] = useState(false)

  const { origins, invalid } = parseOrigins(originsText)
  const rateNum = Number(rate)
  const dailyNum = Number(daily)
  const nameError = !name.trim()
  const rateError = !Number.isInteger(rateNum) || rateNum < 1 || rateNum > 600 || rate.trim() === ''
  const dailyError =
    !Number.isInteger(dailyNum) || dailyNum < 0 || dailyNum > 100000 || daily.trim() === ''
  const hasError = nameError || rateError || dailyError || invalid.length > 0

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (hasError) return
    onSubmit({
      name: name.trim(),
      allowed_origins: origins,
      rate_limit_per_minute: rateNum,
      daily_limit: dailyNum,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="widget-key-name">{t('widget.keyName')}</Label>
        <Input
          id="widget-key-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('widget.keyNamePlaceholder')}
          maxLength={120}
        />
        {submitted && nameError && (
          <p className="text-xs text-destructive">{t('widget.nameRequired')}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="widget-key-origins">{t('widget.allowedOrigins')}</Label>
        <Textarea
          id="widget-key-origins"
          value={originsText}
          onChange={(e) => setOriginsText(e.target.value)}
          placeholder={t('widget.allowedOriginsPlaceholder')}
          rows={4}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">{t('widget.allowedOriginsHelp')}</p>
        {invalid.length > 0 && (
          <p className="text-xs text-destructive" role="alert">
            {t('widget.originsInvalid', { origins: invalid.join(', ') })}
          </p>
        )}
        {origins.length === 0 && invalid.length === 0 && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{t('widget.anyOriginWarning')}</span>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="widget-key-rate">{t('widget.rateLimit')}</Label>
          <Input
            id="widget-key-rate"
            type="number"
            min={1}
            max={600}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('widget.rateLimitHelp')}</p>
          {submitted && rateError && (
            <p className="text-xs text-destructive">{t('widget.rateLimitInvalid')}</p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="widget-key-daily">{t('widget.dailyLimit')}</Label>
          <Input
            id="widget-key-daily"
            type="number"
            min={0}
            max={100000}
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t('widget.dailyLimitHelp')}</p>
          {submitted && dailyError && (
            <p className="text-xs text-destructive">{t('widget.dailyLimitInvalid')}</p>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('widget.back')}
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}

/**
 * Manage the website widget keys of a notebook and get the embed snippet.
 */
export function NotebookWidgetDialog({ notebook, open, onOpenChange }: NotebookWidgetDialogProps) {
  const { t, language } = useTranslation()
  const dfLocale = getDateLocale(language)
  const { data: keys = [], isLoading } = useWidgetKeys(notebook.id, { enabled: open })
  const createKey = useCreateWidgetKey(notebook.id)
  const updateKey = useUpdateWidgetKey()
  const regenerateKey = useRegenerateWidgetKey()
  const deleteKey = useDeleteWidgetKey()

  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<WidgetKey | null>(null)
  const [created, setCreated] = useState<WidgetKeyCreated | null>(null)
  const [toRegenerate, setToRegenerate] = useState<WidgetKey | null>(null)
  const [toDelete, setToDelete] = useState<WidgetKey | null>(null)
  const [apiUrl, setApiUrl] = useState('')

  // Reset the view every time the dialog opens: the full key must not linger
  useEffect(() => {
    if (open) {
      setMode('list')
      setEditing(null)
      setCreated(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    getApiUrl()
      .catch(() => '')
      .then((url) => {
        if (cancelled) return
        setApiUrl(url || (typeof window !== 'undefined' ? window.location.origin : ''))
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const handleSubmit = async (values: {
    name: string
    allowed_origins: string[]
    rate_limit_per_minute: number
    daily_limit: number
  }) => {
    try {
      if (editing) {
        await updateKey.mutateAsync({ id: editing.id, data: values })
      } else {
        setCreated(await createKey.mutateAsync(values))
      }
      setMode('list')
      setEditing(null)
    } catch {
      // Error toast is shown by the mutation hook
    }
  }

  const handleRegenerate = async () => {
    if (!toRegenerate) return
    try {
      setCreated(await regenerateKey.mutateAsync(toRegenerate.id))
    } catch {
      // Error toast is shown by the mutation hook
    }
    setToRegenerate(null)
  }

  const handleDelete = async () => {
    if (!toDelete) return
    const id = toDelete.id
    try {
      await deleteKey.mutateAsync(id)
      setCreated((current) => (current?.id === id ? null : current))
    } catch {
      // Error toast is shown by the mutation hook
    }
    setToDelete(null)
  }

  const snippetKey = created?.key ?? PLACEHOLDER_WIDGET_KEY
  const snippet = (variant: 'floating' | 'inline') =>
    buildEmbedSnippet({
      apiUrl,
      notebookId: notebook.id,
      widgetKey: snippetKey,
      title: notebook.name,
      variant,
    })

  const showSnippet = keys.length > 0 || created !== null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>{t('widget.title')}</DialogTitle>
            <DialogDescription>{t('widget.description')}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              {t('widget.publicNote')}
            </p>

            {mode === 'form' ? (
              <KeyForm
                key={editing?.id ?? 'new'}
                initial={editing}
                isPending={createKey.isPending || updateKey.isPending}
                onCancel={() => {
                  setMode('list')
                  setEditing(null)
                }}
                onSubmit={handleSubmit}
              />
            ) : (
              <>
                {created && (
                  <div
                    className="space-y-2 rounded-md border border-primary/50 bg-fern-tint p-3"
                    data-testid="widget-created-key"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <KeyRound className="h-4 w-4" />
                      {t('widget.newKeyTitle', { name: created.name })}
                    </div>
                    <code className="block break-all rounded bg-background p-2 font-mono text-sm">
                      {created.key}
                    </code>
                    <p className="text-xs font-medium">{t('widget.copyNow')}</p>
                    <div className="flex gap-2">
                      <CopyButton value={created.key} label={t('widget.copyKey')} />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCreated(null)}
                      >
                        {t('widget.dismiss')}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">{t('widget.keysHeading')}</h3>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setEditing(null)
                      setMode('form')
                    }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {t('widget.createKey')}
                  </Button>
                </div>

                {isLoading ? (
                  <div className="flex justify-center py-6">
                    <LoadingSpinner />
                  </div>
                ) : keys.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {t('widget.empty')}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {keys.map((key) => (
                      <li key={key.id} className="space-y-2 rounded-md border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{key.name}</span>
                          <code className="text-xs text-muted-foreground">{key.key_prefix}…</code>
                          <label className="ml-auto flex items-center gap-2 text-xs">
                            <Checkbox
                              checked={key.enabled}
                              disabled={updateKey.isPending}
                              onCheckedChange={(checked) =>
                                updateKey.mutate({ id: key.id, data: { enabled: checked === true } })
                              }
                              aria-label={t('widget.enabled')}
                            />
                            {t('widget.enabled')}
                          </label>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {key.allowed_origins.length === 0 ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                            >
                              <AlertTriangle />
                              {t('widget.anyOrigin')}
                            </Badge>
                          ) : (
                            <span
                              className="max-w-full truncate font-mono"
                              title={key.allowed_origins.join('\n')}
                            >
                              {key.allowed_origins.join(', ')}
                            </span>
                          )}
                          <span>{t('widget.limitRate', { value: key.rate_limit_per_minute })}</span>
                          <span>
                            {key.daily_limit > 0
                              ? t('widget.limitDaily', { value: key.daily_limit })
                              : t('widget.limitDailyUnlimited')}
                          </span>
                          <span>
                            {key.last_used_at
                              ? t('widget.lastUsed', {
                                  time: formatDistanceToNow(new Date(key.last_used_at), {
                                    addSuffix: true,
                                    locale: dfLocale,
                                  }),
                                })
                              : t('widget.neverUsed')}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditing(key)
                              setMode('form')
                            }}
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            {t('common.edit')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setToRegenerate(key)}
                          >
                            <RefreshCw className="h-4 w-4 mr-2" />
                            {t('widget.regenerate')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setToDelete(key)}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t('common.delete')}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {showSnippet && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">{t('widget.embedTitle')}</h3>
                    {!created && (
                      <p className="text-xs text-muted-foreground">
                        {t('widget.placeholderKeyNote', { placeholder: PLACEHOLDER_WIDGET_KEY })}
                      </p>
                    )}
                    <Tabs defaultValue="floating">
                      <TabsList>
                        <TabsTrigger value="floating">{t('widget.floatingTab')}</TabsTrigger>
                        <TabsTrigger value="inline">{t('widget.inlineTab')}</TabsTrigger>
                      </TabsList>
                      {(['floating', 'inline'] as const).map((variant) => (
                        <TabsContent key={variant} value={variant} className="space-y-2">
                          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                            <code data-testid={`widget-snippet-${variant}`}>{snippet(variant)}</code>
                          </pre>
                          <CopyButton value={snippet(variant)} label={t('widget.copyEmbed')} />
                        </TabsContent>
                      ))}
                    </Tabs>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">{t('widget.searchModeTitle')}</p>
                      <ul className="list-disc space-y-0.5 pl-4">
                        <li>{t('widget.searchModeInsightsFirst')}</li>
                        <li>{t('widget.searchModeInsights')}</li>
                        <li>{t('widget.searchModeFull')}</li>
                      </ul>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toRegenerate !== null}
        onOpenChange={(next) => !next && setToRegenerate(null)}
        title={t('widget.regenerateConfirmTitle')}
        description={t('widget.regenerateConfirmDesc')}
        onConfirm={handleRegenerate}
        isLoading={regenerateKey.isPending}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(next) => !next && setToDelete(null)}
        title={t('widget.deleteConfirmTitle')}
        description={t('widget.deleteConfirmDesc')}
        confirmVariant="destructive"
        onConfirm={handleDelete}
        isLoading={deleteKey.isPending}
      />
    </>
  )
}
