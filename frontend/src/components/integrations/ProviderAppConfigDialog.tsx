'use client'

import { useEffect, useState } from 'react'
import { Copy, ExternalLink, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useToast } from '@/lib/hooks/use-toast'
import { useUpdateProviderAppConfig } from '@/lib/hooks/use-integrations'
import type { IntegrationProvider } from '@/lib/api/integrations'

interface ProviderAppConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: IntegrationProvider
}

export function ProviderAppConfigDialog({
  open,
  onOpenChange,
  provider,
}: ProviderAppConfigDialogProps) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const updateConfig = useUpdateProviderAppConfig()

  const isEnvManaged = provider.config_source === 'env'
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  // Dialogs don't reset their own state: re-seed on every open
  useEffect(() => {
    if (open) {
      setClientId(provider.client_id ?? '')
      setClientSecret('')
    }
  }, [open, provider.client_id])

  const needsSecret = !provider.has_secret
  const isValid =
    clientId.trim() !== '' && (!needsSecret || clientSecret.trim() !== '')

  const handleCopy = async () => {
    if (!provider.redirect_uri) return
    try {
      await navigator.clipboard.writeText(provider.redirect_uri)
      toast({ title: t('common.success'), description: t('integrations.redirectUriCopied') })
    } catch {
      toast({
        title: t('common.error'),
        description: t('integrations.copyFailed'),
        variant: 'destructive',
      })
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isEnvManaged || !isValid) return
    const secret = clientSecret.trim()
    updateConfig.mutate(
      {
        provider: provider.provider,
        data: {
          client_id: clientId.trim(),
          // null keeps the stored secret
          client_secret: secret ? secret : null,
        },
      },
      { onSuccess: () => onOpenChange(false) }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('integrations.configureAppTitle', { provider: provider.display_name })}
          </DialogTitle>
          <DialogDescription>{t('integrations.configureAppDescription')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isEnvManaged && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{t('integrations.managedByEnv')}</Badge>
              <span className="text-xs text-muted-foreground">
                {t('integrations.managedByEnvHint')}
              </span>
            </div>
          )}

          {/* Redirect URI */}
          <div className="space-y-2">
            <Label htmlFor="integration-redirect-uri">{t('integrations.redirectUri')}</Label>
            {provider.redirect_uri ? (
              <div className="flex gap-2">
                <Input
                  id="integration-redirect-uri"
                  value={provider.redirect_uri}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleCopy}
                  aria-label={t('integrations.copyRedirectUri')}
                  title={t('integrations.copyRedirectUri')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{t('integrations.redirectUriMissing')}</AlertDescription>
              </Alert>
            )}
            <p className="text-xs text-muted-foreground">{t('integrations.redirectUriHint')}</p>
          </div>

          {/* Client ID */}
          <div className="space-y-2">
            <Label htmlFor="integration-client-id">{t('integrations.clientId')}</Label>
            <Input
              id="integration-client-id"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              readOnly={isEnvManaged}
              disabled={isEnvManaged}
              autoComplete="off"
            />
          </div>

          {/* Client secret */}
          {!isEnvManaged && (
            <div className="space-y-2">
              <Label htmlFor="integration-client-secret">{t('integrations.clientSecret')}</Label>
              <Input
                id="integration-client-secret"
                type="password"
                value={clientSecret}
                onChange={e => setClientSecret(e.target.value)}
                placeholder={provider.has_secret ? t('integrations.clientSecretKeepPlaceholder') : ''}
                autoComplete="new-password"
              />
            </div>
          )}

          <a
            href={provider.console_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            {t('integrations.openConsole', { provider: provider.display_name })}
            <ExternalLink className="h-3 w-3" />
          </a>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {isEnvManaged ? t('common.close') : t('common.cancel')}
            </Button>
            {!isEnvManaged && (
              <Button type="submit" disabled={!isValid || updateConfig.isPending}>
                {updateConfig.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('common.save')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
