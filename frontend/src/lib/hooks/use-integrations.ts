import { useEffect, useRef } from 'react'
import { QueryClient, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import {
  integrationsApi,
  ImportLinksRequest,
  IntegrationProviderName,
  SourceCloudInfo,
  SourceCloudMap,
  SyncLink,
  UpdateIntegrationSettingsRequest,
  UpdateLinkRequest,
  UpdateProviderAppConfigRequest,
} from '@/lib/api/integrations'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'

/** How often links / cloud info are polled while a sync is queued/running. */
export const SYNC_POLL_INTERVAL_MS = 5000

export const INTEGRATION_QUERY_KEYS = {
  all: ['integrations'] as const,
  providers: ['integrations', 'providers'] as const,
  settings: ['integrations', 'settings'] as const,
  accounts: ['integrations', 'accounts'] as const,
  browse: (accountId: string, parentId?: string) =>
    ['integrations', 'accounts', accountId, 'browse', parentId ?? 'root'] as const,
  /** Prefix of every link query (lists and per-link files). */
  links: ['integrations', 'links'] as const,
  linkList: (notebookId?: string) => ['integrations', 'links', 'list', notebookId ?? 'all'] as const,
  linkFiles: (linkId: string) => ['integrations', 'links', 'files', linkId] as const,
  sourceMap: ['integrations', 'source-map'] as const,
  /** Prefix of every per-source cloud info query. */
  sources: ['integrations', 'sources'] as const,
  source: (sourceId: string) => ['integrations', 'sources', sourceId] as const,
}

function isActiveStatus(status: string | undefined): boolean {
  return status === 'queued' || status === 'running'
}

/** True when at least one link has a sync queued or in progress. */
export function hasActiveSync(links: SyncLink[] | undefined): boolean {
  return !!links?.some(l => isActiveStatus(l.status))
}

/** True when any cloud-imported source belongs to a link that is syncing. */
export function hasActiveSourceSync(map: SourceCloudMap | undefined): boolean {
  return !!map && Object.values(map).some(info => isActiveStatus(info.link_status))
}

/**
 * Everything that can change after a cloud action: links (and their files),
 * the source badges/cloud info, and every source list (notebook columns,
 * /sources, source detail).
 */
function invalidateCloudState(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.links })
  queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.sourceMap })
  queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.sources })
  queryClient.invalidateQueries({ queryKey: ['sources'] })
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useIntegrationProviders() {
  return useQuery({
    queryKey: INTEGRATION_QUERY_KEYS.providers,
    queryFn: () => integrationsApi.listProviders(),
  })
}

export function useIntegrationSettings() {
  return useQuery({
    queryKey: INTEGRATION_QUERY_KEYS.settings,
    queryFn: () => integrationsApi.getSettings(),
  })
}

export function useIntegrationAccounts() {
  return useQuery({
    queryKey: INTEGRATION_QUERY_KEYS.accounts,
    queryFn: () => integrationsApi.listAccounts(),
  })
}

export function useRemoteBrowse(accountId: string, parentId?: string, enabled = true) {
  return useQuery({
    queryKey: INTEGRATION_QUERY_KEYS.browse(accountId, parentId),
    queryFn: () => integrationsApi.browse(accountId, parentId),
    enabled: !!accountId && enabled,
    // Remote trees change outside the app; don't serve a stale listing
    staleTime: 0,
  })
}

/**
 * Lists links (optionally only those importing into a notebook), polling
 * every few seconds while any sync is queued or running so status / last
 * sync time update without a manual refresh.
 */
export function useSyncLinks(notebookId?: string) {
  return useQuery({
    queryKey: INTEGRATION_QUERY_KEYS.linkList(notebookId),
    queryFn: () => integrationsApi.listLinks(notebookId),
    refetchInterval: query => (hasActiveSync(query.state.data) ? SYNC_POLL_INTERVAL_MS : false),
  })
}

/**
 * Watches the links and refreshes source lists once a running sync finishes,
 * so newly imported / updated / deleted sources show up without a reload.
 * Mount it once per source list (not per card).
 */
export function useRefreshSourcesAfterSync(onSyncFinished?: () => void) {
  const queryClient = useQueryClient()
  const { data: links } = useSyncLinks()
  const active = hasActiveSync(links)
  const wasActive = useRef(false)
  const callbackRef = useRef(onSyncFinished)

  useEffect(() => {
    callbackRef.current = onSyncFinished
  }, [onSyncFinished])

  useEffect(() => {
    if (wasActive.current && !active) {
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.sourceMap })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebooks })
      callbackRef.current?.()
    }
    wasActive.current = active
  }, [active, queryClient])
}

export function useLinkFiles(linkId: string, options?: { enabled?: boolean; poll?: boolean }) {
  return useQuery({
    queryKey: INTEGRATION_QUERY_KEYS.linkFiles(linkId),
    queryFn: () => integrationsApi.listLinkFiles(linkId),
    enabled: !!linkId && (options?.enabled ?? true),
    refetchInterval: options?.poll ? SYNC_POLL_INTERVAL_MS : false,
  })
}

/**
 * Cloud origin of every cloud-imported source, keyed by source id. One cached
 * query shared by every source badge; polls while one of their links syncs.
 */
export function useSourceCloudMap() {
  return useQuery({
    queryKey: INTEGRATION_QUERY_KEYS.sourceMap,
    queryFn: () => integrationsApi.getSourceMap(),
    staleTime: 60 * 1000,
    refetchInterval: query =>
      hasActiveSourceSync(query.state.data) ? SYNC_POLL_INTERVAL_MS : false,
  })
}

/** Convenience selector over the shared source map. */
export function useSourceCloudEntry(sourceId: string): SourceCloudInfo | undefined {
  const { data } = useSourceCloudMap()
  return data?.[sourceId]
}

/** Fresh cloud info for one source (source detail view). 404 = not from the cloud. */
export function useSourceCloudInfo(sourceId: string, enabled = true) {
  return useQuery({
    queryKey: INTEGRATION_QUERY_KEYS.source(sourceId),
    queryFn: () => integrationsApi.getSourceCloudInfo(sourceId),
    enabled: !!sourceId && enabled,
    refetchInterval: query =>
      isActiveStatus(query.state.data?.link_status) ? SYNC_POLL_INTERVAL_MS : false,
  })
}

// ---------------------------------------------------------------------------
// Provider app config
// ---------------------------------------------------------------------------

export function useUpdateProviderAppConfig() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({
      provider,
      data,
    }: {
      provider: IntegrationProviderName
      data: UpdateProviderAppConfigRequest
    }) => integrationsApi.updateProvider(provider, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.providers })
      toast({
        title: t('common.success'),
        description: t('integrations.appConfigSaved'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, t, 'integrations.appConfigSaveFailed'),
        variant: 'destructive',
      })
    },
  })
}

export function useDeleteProviderAppConfig() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (provider: IntegrationProviderName) => integrationsApi.deleteProvider(provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.providers })
      toast({
        title: t('common.success'),
        description: t('integrations.appConfigDeleted'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, t, 'integrations.appConfigDeleteFailed'),
        variant: 'destructive',
      })
    },
  })
}

/**
 * Starts the OAuth flow. The caller redirects the browser to the returned
 * authorize_url; the provider then redirects back to /settings/integrations.
 */
export function useAuthorizeProvider() {
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (provider: IntegrationProviderName) => integrationsApi.authorize(provider),
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, t, 'integrations.connectFailed'),
        variant: 'destructive',
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function useUpdateIntegrationSettings() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (data: UpdateIntegrationSettingsRequest) => integrationsApi.updateSettings(data),
    onSuccess: data => {
      queryClient.setQueryData(INTEGRATION_QUERY_KEYS.settings, data)
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.settings })
      // redirect_uri is derived from the public URL
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.providers })
      toast({
        title: t('common.success'),
        description: t('integrations.settingsSaved'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, t, 'integrations.settingsSaveFailed'),
        variant: 'destructive',
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export function useDisconnectAccount() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (accountId: string) => integrationsApi.deleteAccount(accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.accounts })
      invalidateCloudState(queryClient)
      toast({
        title: t('common.success'),
        description: t('integrations.accountDisconnected'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, t, 'integrations.disconnectFailed'),
        variant: 'destructive',
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** Shared 409-aware error handler for "Sync now" actions. */
function useSyncErrorHandler() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()
  return (error: unknown) => {
    if (isAxiosError(error) && error.response?.status === 409) {
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.links })
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.sources })
      toast({
        title: t('common.error'),
        description: t('integrations.syncAlreadyRunning'),
        variant: 'destructive',
      })
      return
    }
    toast({
      title: t('common.error'),
      description: getApiErrorMessage(error, t, 'integrations.syncFailed'),
      variant: 'destructive',
    })
  }
}

/**
 * Imports the chosen cloud files/folders (POST /links/import). The first
 * import of each link is queued immediately, so sources appear shortly after.
 */
export function useImportLinks() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (data: ImportLinksRequest) => integrationsApi.importLinks(data),
    // Importing twice would just reuse the links; don't retry a partial failure blindly
    retry: false,
    onSuccess: data => {
      invalidateCloudState(queryClient)
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.accounts })
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebooks })
      const description =
        data.reused_sources > 0
          ? `${t('integrations.importQueued', { count: data.links.length })} ${t(
              'integrations.importReusedSources',
              { count: data.reused_sources }
            )}`
          : t('integrations.importQueued', { count: data.links.length })
      toast({ title: t('common.success'), description })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, t, 'integrations.importFailed'),
        variant: 'destructive',
      })
    },
  })
}

export function useUpdateLink(options?: { silent?: boolean }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateLinkRequest }) =>
      integrationsApi.updateLink(id, data),
    onSuccess: () => {
      // notebook_ids changes relink sources; sync_enabled changes the badges
      invalidateCloudState(queryClient)
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebooks })
      if (!options?.silent) {
        toast({
          title: t('common.success'),
          description: t('integrations.linkUpdated'),
        })
      }
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, t, 'integrations.linkUpdateFailed'),
        variant: 'destructive',
      })
    },
  })
}

export function useDeleteLink() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (id: string) => integrationsApi.deleteLink(id),
    onSuccess: () => {
      invalidateCloudState(queryClient)
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.accounts })
      toast({
        title: t('common.success'),
        description: t('integrations.linkDeleted'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, t, 'integrations.linkDeleteFailed'),
        variant: 'destructive',
      })
    },
  })
}

export function useTriggerLinkSync() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()
  const handleError = useSyncErrorHandler()

  return useMutation({
    mutationFn: (id: string) => integrationsApi.syncLink(id),
    // A sync is fire-and-forget; retrying would just hit the 409 guard
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.links })
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.sourceMap })
      toast({
        title: t('common.success'),
        description: t('integrations.syncQueued'),
      })
    },
    onError: handleError,
  })
}

// ---------------------------------------------------------------------------
// Synced files (inside a folder link)
// ---------------------------------------------------------------------------

export function useUpdateSyncedFile() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ id, syncEnabled }: { id: string; syncEnabled: boolean }) =>
      integrationsApi.updateSyncedFile(id, { sync_enabled: syncEnabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.links })
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.sourceMap })
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.sources })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, t, 'integrations.fileUpdateFailed'),
        variant: 'destructive',
      })
    },
  })
}

export function useExcludeSyncedFile() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ id, deleteSource }: { id: string; deleteSource: boolean }) =>
      integrationsApi.excludeSyncedFile(id, deleteSource),
    onSuccess: () => {
      // The source is either deleted or detached (no longer cloud-linked)
      invalidateCloudState(queryClient)
      toast({
        title: t('common.success'),
        description: t('integrations.fileExcluded'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, t, 'integrations.fileUpdateFailed'),
        variant: 'destructive',
      })
    },
  })
}

export function useIncludeSyncedFile() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: (id: string) => integrationsApi.includeSyncedFile(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.links })
      toast({
        title: t('common.success'),
        description: t('integrations.fileIncluded'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, t, 'integrations.fileUpdateFailed'),
        variant: 'destructive',
      })
    },
  })
}

// ---------------------------------------------------------------------------
// Per-source controls
// ---------------------------------------------------------------------------

export function useUpdateSourceSync() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return useMutation({
    mutationFn: ({ sourceId, syncEnabled }: { sourceId: string; syncEnabled: boolean }) =>
      integrationsApi.updateSourceSync(sourceId, syncEnabled),
    onSuccess: data => {
      queryClient.setQueryData(INTEGRATION_QUERY_KEYS.source(data.source_id), data)
      queryClient.setQueryData<SourceCloudMap>(INTEGRATION_QUERY_KEYS.sourceMap, prev =>
        prev ? { ...prev, [data.source_id]: data } : prev
      )
      // A file link toggles the whole link; a folder file changes the file list
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.links })
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.sourceMap })
      toast({
        title: t('common.success'),
        description: data.sync_enabled
          ? t('integrations.sourceSyncOn')
          : t('integrations.sourceSyncOff'),
      })
    },
    onError: (error: unknown) => {
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, t, 'integrations.sourceSyncUpdateFailed'),
        variant: 'destructive',
      })
    },
  })
}

export function useTriggerSourceSync() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()
  const handleError = useSyncErrorHandler()

  return useMutation({
    mutationFn: (sourceId: string) => integrationsApi.syncSource(sourceId),
    retry: false,
    onSuccess: (_data, sourceId) => {
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.source(sourceId) })
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.sourceMap })
      queryClient.invalidateQueries({ queryKey: INTEGRATION_QUERY_KEYS.links })
      toast({
        title: t('common.success'),
        description: t('integrations.syncQueued'),
      })
    },
    onError: handleError,
  })
}
