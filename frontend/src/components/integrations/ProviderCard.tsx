'use client'

import { useState } from 'react'
import { Check, X, Info, Link2, Loader2, Settings2, Trash2, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  useAuthorizeProvider,
  useDeleteProviderAppConfig,
  useDisconnectAccount,
} from '@/lib/hooks/use-integrations'
import type { IntegrationAccount, IntegrationProvider } from '@/lib/api/integrations'
import { ProviderAppConfigDialog } from './ProviderAppConfigDialog'
import { RemoveCloudDialog } from './RemoveCloudDialog'
import { ProviderIcon } from './integration-utils'

interface ProviderCardProps {
  provider: IntegrationProvider
  accounts: IntegrationAccount[]
}

export function ProviderCard({ provider, accounts }: ProviderCardProps) {
  const { t } = useTranslation()
  const [configOpen, setConfigOpen] = useState(false)
  const [deleteConfigOpen, setDeleteConfigOpen] = useState(false)
  const [accountToDisconnect, setAccountToDisconnect] = useState<IntegrationAccount | null>(null)

  const authorize = useAuthorizeProvider()
  const deleteConfig = useDeleteProviderAppConfig()
  const disconnect = useDisconnectAccount()

  const isEnvManaged = provider.config_source === 'env'
  const canConnect = provider.configured && !!provider.redirect_uri

  const handleConnect = () => {
    authorize.mutate(provider.provider, {
      onSuccess: ({ authorize_url }) => {
        window.location.href = authorize_url
      },
    })
  }

  const handleDeleteConfig = () => {
    deleteConfig.mutate(provider.provider, {
      onSettled: () => setDeleteConfigOpen(false),
    })
  }

  const handleDisconnect = (deleteSources: boolean) => {
    if (!accountToDisconnect) return
    disconnect.mutate(
      { accountId: accountToDisconnect.id, deleteSources },
      { onSettled: () => setAccountToDisconnect(null) }
    )
  }

  return (
    <Card className={provider.configured ? 'border-l-2 border-l-fern' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <ProviderIcon provider={provider.provider} className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">{provider.display_name}</CardTitle>
            {isEnvManaged && (
              <Badge variant="secondary">{t('integrations.managedByEnv')}</Badge>
            )}
          </div>
          {provider.configured ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-fern">
              <Check className="h-3 w-3" />
              {t('integrations.appConfigured')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <X className="h-3 w-3" />
              {t('integrations.appNotConfigured')}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* App config summary */}
        <div className="rounded-md border p-3 space-y-2">
          <div className="grid gap-1 text-sm">
            <div className="flex gap-2 min-w-0">
              <span className="text-muted-foreground shrink-0">{t('integrations.clientId')}:</span>
              <span className="font-mono text-xs truncate self-center">
                {provider.client_id || t('integrations.notSet')}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="text-muted-foreground">{t('integrations.clientSecret')}:</span>
              <span>
                {provider.has_secret ? t('integrations.secretSet') : t('integrations.notSet')}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
              <Settings2 className="h-4 w-4" />
              {isEnvManaged ? t('integrations.viewAppConfig') : t('integrations.configureApp')}
            </Button>
            {!isEnvManaged && provider.config_source === 'db' && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleteConfigOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                {t('integrations.deleteAppConfig')}
              </Button>
            )}
          </div>
        </div>

        {provider.provider === 'google_drive' && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            {t('integrations.googleTestingModeNote')}
          </p>
        )}

        {/* Connected accounts */}
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('integrations.connectedAccounts')}</h3>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('integrations.noAccounts')}</p>
          ) : (
            <ul className="space-y-2">
              {accounts.map(account => (
                <li
                  key={account.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{account.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {account.account_email ? `${account.account_email} · ` : ''}
                      {t('integrations.syncFolderCount', { count: account.sync_folder_count })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive shrink-0"
                    onClick={() => setAccountToDisconnect(account)}
                  >
                    <Unplug className="h-4 w-4" />
                    {t('integrations.disconnect')}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={handleConnect}
            disabled={!canConnect || authorize.isPending}
          >
            {authorize.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            {t('integrations.connectAccount')}
          </Button>
          {!provider.configured ? (
            <p className="text-xs text-muted-foreground">{t('integrations.connectNeedsApp')}</p>
          ) : !provider.redirect_uri ? (
            <p className="text-xs text-muted-foreground">{t('integrations.connectNeedsPublicUrl')}</p>
          ) : null}
        </div>
      </CardContent>

      {configOpen && (
        <ProviderAppConfigDialog
          open={configOpen}
          onOpenChange={setConfigOpen}
          provider={provider}
        />
      )}

      <ConfirmDialog
        open={deleteConfigOpen}
        onOpenChange={setDeleteConfigOpen}
        title={t('integrations.deleteAppConfigTitle')}
        description={t('integrations.deleteAppConfigConfirm', { provider: provider.display_name })}
        confirmText={t('common.delete')}
        confirmVariant="destructive"
        onConfirm={handleDeleteConfig}
        isLoading={deleteConfig.isPending}
      />

      <RemoveCloudDialog
        open={!!accountToDisconnect}
        onOpenChange={open => {
          if (!open) setAccountToDisconnect(null)
        }}
        title={t('integrations.disconnectTitle')}
        description={t('integrations.disconnectConfirm', {
          name: accountToDisconnect?.name ?? '',
          count: accountToDisconnect?.sync_folder_count ?? 0,
        })}
        confirmText={t('integrations.disconnect')}
        deleteLabel={
          accountToDisconnect?.sync_folder_count ? t('integrations.alsoDeleteSources') : undefined
        }
        onConfirm={handleDisconnect}
        isLoading={disconnect.isPending}
      />
    </Card>
  )
}
