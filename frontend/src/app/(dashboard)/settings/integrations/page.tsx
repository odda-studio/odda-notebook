'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertCircle, FolderSync } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useToast } from '@/lib/hooks/use-toast'
import {
  useIntegrationAccounts,
  useIntegrationProviders,
  useIntegrationSettings,
} from '@/lib/hooks/use-integrations'
import type { IntegrationAccount } from '@/lib/api/integrations'
import { LinkList, ProviderCard, SyncSettingsForm } from '@/components/integrations'

export default function IntegrationsPage() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()

  const {
    data: providers,
    isLoading: providersLoading,
    isError: providersError,
  } = useIntegrationProviders()
  const { data: accounts, isLoading: accountsLoading } = useIntegrationAccounts()
  const {
    data: settings,
    isLoading: settingsLoading,
    isError: settingsError,
  } = useIntegrationSettings()

  // OAuth callback result: ?connected=<provider> or ?integration_error=<msg>
  const handledCallback = useRef(false)
  useEffect(() => {
    if (handledCallback.current) return
    const connected = searchParams?.get('connected')
    const integrationError = searchParams?.get('integration_error')
    if (!connected && !integrationError) return
    // Wait for the provider list so the toast can show the display name
    if (connected && providersLoading) return
    handledCallback.current = true

    if (connected) {
      const name = providers?.find(p => p.provider === connected)?.display_name ?? connected
      toast({
        title: t('common.success'),
        description: t('integrations.connectedToast', { provider: name }),
      })
    } else if (integrationError) {
      toast({
        title: t('integrations.connectErrorToast'),
        description: integrationError,
        variant: 'destructive',
      })
    }
    router.replace('/settings/integrations')
  }, [searchParams, providers, providersLoading, router, t, toast])

  const accountsByProvider = useMemo(() => {
    const grouped: Record<string, IntegrationAccount[]> = {}
    for (const account of accounts ?? []) {
      if (!grouped[account.provider]) grouped[account.provider] = []
      grouped[account.provider].push(account)
    }
    return grouped
  }, [accounts])

  if (providersLoading || accountsLoading || settingsLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[60vh]">
          <LoadingSpinner size="lg" />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-8">
          {/* Header */}
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
              <FolderSync className="h-5 w-5 text-muted-foreground" />
              {t('integrations.title')}
            </h1>
            <p className="text-muted-foreground mt-1">{t('integrations.description')}</p>
          </div>

          {/* Providers */}
          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">{t('integrations.providersTitle')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('integrations.providersDescription')}
              </p>
            </div>
            {providersError ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t('integrations.providersLoadFailed')}</AlertTitle>
                <AlertDescription>{t('integrations.tryAgainLater')}</AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {(providers ?? []).map(provider => (
                  <ProviderCard
                    key={provider.provider}
                    provider={provider}
                    accounts={accountsByProvider[provider.provider] ?? []}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Linked cloud items */}
          <section>
            <LinkList accounts={accounts ?? []} />
          </section>

          {/* Sync settings */}
          <section>
            {settingsError || !settings ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{t('integrations.settingsLoadFailed')}</AlertTitle>
                <AlertDescription>{t('integrations.tryAgainLater')}</AlertDescription>
              </Alert>
            ) : (
              <SyncSettingsForm settings={settings} />
            )}
          </section>
        </div>
      </div>
    </AppShell>
  )
}
