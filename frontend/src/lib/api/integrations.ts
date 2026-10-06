import apiClient from './client'

// Types for the cloud storage integrations API (Dropbox / Google Drive sync)

export type IntegrationProviderName = 'dropbox' | 'google_drive'

/** "env" => managed by environment variables (read-only in the UI). */
export type IntegrationConfigSource = 'env' | 'db' | null

export interface IntegrationProvider {
  provider: IntegrationProviderName
  display_name: string
  configured: boolean
  config_source: IntegrationConfigSource
  client_id: string | null
  has_secret: boolean
  redirect_uri: string | null
  console_url: string
}

export interface UpdateProviderAppConfigRequest {
  client_id: string
  /** Omitted/null keeps the existing secret. */
  client_secret?: string | null
}

export type GoogleDocumentExportFormat = 'docx' | 'pdf' | 'md' | 'txt'
export type GoogleSpreadsheetExportFormat = 'xlsx' | 'csv' | 'pdf'
export type GooglePresentationExportFormat = 'pptx' | 'pdf'

export interface GoogleExportFormats {
  document: GoogleDocumentExportFormat
  spreadsheet: GoogleSpreadsheetExportFormat
  presentation: GooglePresentationExportFormat
}

export interface IntegrationSettings {
  public_url: string | null
  public_url_source: IntegrationConfigSource
  scheduler_enabled: boolean
  scheduler_forced_off: boolean
  default_interval_minutes: number
  max_file_mb: number
  allowed_extensions: string[]
  google_export_formats: GoogleExportFormats
}

export type UpdateIntegrationSettingsRequest = Partial<
  Pick<
    IntegrationSettings,
    | 'public_url'
    | 'scheduler_enabled'
    | 'default_interval_minutes'
    | 'max_file_mb'
    | 'allowed_extensions'
    | 'google_export_formats'
  >
>

export interface AuthorizeResponse {
  authorize_url: string
}

export interface IntegrationAccount {
  id: string
  provider: IntegrationProviderName
  name: string
  account_email: string | null
  sync_folder_count: number
  created: string
  updated: string
}

/** A cloud storage link points at either a single file or a folder. */
export type LinkKind = 'folder' | 'file'

export interface RemoteItem {
  id: string
  name: string
  path: string
  kind: LinkKind
  size: number | null
  modified_at: string | null
  mime_type: string | null
  /** For Google-native docs: the export extension (e.g. "docx"). */
  extension: string | null
  /** Files: passes the allowed-extension / size filters. Folders: always true. */
  eligible: boolean
  /** Open the item in Dropbox / Google Drive. */
  web_url: string | null
  /** False for virtual groupings ("Shared with me", shared drives): open-only. */
  selectable?: boolean
}

export interface RemoteSearchResponse {
  query: string
  items: RemoteItem[]
  /** More matches exist than returned. */
  truncated: boolean
}

export interface BrowseResponse {
  parent_id: string
  path: string
  /** Whether the current folder itself can be linked (false for virtual groupings). */
  selectable?: boolean
  /** Folders first, then files, by name. */
  items: RemoteItem[]
}

export type SyncLinkStatus = 'idle' | 'queued' | 'running' | 'error'

export interface SyncLink {
  id: string
  account_id: string
  provider: IntegrationProviderName
  account_name: string
  kind: LinkKind
  remote_id: string
  remote_path: string
  name: string
  web_url: string | null
  /** Empty = general sources only (not added to any notebook). */
  notebook_ids: string[]
  notebook_names: string[]
  /** Folders only (ignored for files). */
  recursive: boolean
  interval_minutes: number
  transformations: string[]
  sync_enabled: boolean
  status: SyncLinkStatus
  last_sync_at: string | null
  next_sync_at: string | null
  last_error: string | null
  /** Sources currently imported by this link. */
  file_count: number
}

export interface ImportLinkItem {
  kind: LinkKind
  remote_id: string
  remote_path: string
  name: string
}

export interface ImportLinksRequest {
  account_id: string
  /** 1..100 items */
  items: ImportLinkItem[]
  /** May be empty (general sources only). */
  notebook_ids: string[]
  sync_enabled: boolean
  recursive?: boolean
  /** Defaults to settings.default_interval_minutes; must be >= 5. */
  interval_minutes?: number
  transformations?: string[]
}

export interface ImportLinksResponse {
  links: SyncLink[]
  /** Items that were already linked: their existing sources were reused. */
  reused_sources: number
}

export type UpdateLinkRequest = Partial<
  Pick<SyncLink, 'notebook_ids' | 'recursive' | 'interval_minutes' | 'transformations' | 'sync_enabled'>
>

export type SyncedFileStatus = 'synced' | 'unsupported' | 'error' | 'ignored' | 'excluded'

export interface SyncedFile {
  id: string
  link_id: string
  remote_id: string
  name: string
  path: string | null
  source_id: string | null
  status: SyncedFileStatus
  /** Per-file switch: false freezes the source (never updated nor deleted by sync). */
  sync_enabled: boolean
  last_error: string | null
  remote_modified_at: string | null
  updated: string | null
  web_url: string | null
}

/** Cloud origin of a source (for source cards and the source detail view). */
export interface SourceCloudInfo {
  source_id: string
  provider: IntegrationProviderName
  account_name: string
  link_id: string
  link_kind: LinkKind
  link_name: string
  synced_file_id: string
  /** Effective: link.sync_enabled && file.sync_enabled */
  sync_enabled: boolean
  link_sync_enabled: boolean
  file_sync_enabled: boolean
  file_status: SyncedFileStatus
  link_status: SyncLinkStatus
  last_sync_at: string | null
  last_error: string | null
  remote_path: string | null
  web_url: string | null
}

/** Keyed by source_id; every cloud-imported source. */
export type SourceCloudMap = Record<string, SourceCloudInfo>

/** Outcome of removing a link/account/source from cloud sync. */
export interface CloudRemovalResponse {
  message: string
  sources_deleted: number
  /** Background jobs stopped (syncs, processing of deleted sources). */
  jobs_canceled: number
}

/**
 * stop_sync/resume_sync: toggle sync; disconnect: never sync again, keep the
 * sources as regular ones; delete: never sync again and delete the sources;
 * include: undo a disconnect/exclusion.
 */
export type SyncedFileBulkAction = 'stop_sync' | 'resume_sync' | 'disconnect' | 'delete' | 'include'

export interface SyncedFilesBulkResponse {
  updated: number
  sources_deleted: number
  jobs_canceled: number
}

export interface IntegrationMessageResponse {
  message: string
}

export interface TriggerSyncResponse {
  command_id: string
}

export const integrationsApi = {
  // Provider app config
  listProviders: async (): Promise<IntegrationProvider[]> => {
    const response = await apiClient.get<IntegrationProvider[]>('/integrations/providers')
    return response.data
  },

  updateProvider: async (
    provider: IntegrationProviderName,
    data: UpdateProviderAppConfigRequest
  ): Promise<IntegrationProvider> => {
    const response = await apiClient.put<IntegrationProvider>(
      `/integrations/providers/${provider}`,
      data
    )
    return response.data
  },

  deleteProvider: async (provider: IntegrationProviderName): Promise<IntegrationMessageResponse> => {
    const response = await apiClient.delete<IntegrationMessageResponse>(
      `/integrations/providers/${provider}`
    )
    return response.data
  },

  authorize: async (provider: IntegrationProviderName): Promise<AuthorizeResponse> => {
    const response = await apiClient.post<AuthorizeResponse>(
      `/integrations/providers/${provider}/authorize`
    )
    return response.data
  },

  // Global sync settings
  getSettings: async (): Promise<IntegrationSettings> => {
    const response = await apiClient.get<IntegrationSettings>('/integrations/settings')
    return response.data
  },

  updateSettings: async (data: UpdateIntegrationSettingsRequest): Promise<IntegrationSettings> => {
    const response = await apiClient.put<IntegrationSettings>('/integrations/settings', data)
    return response.data
  },

  // Connected accounts
  listAccounts: async (): Promise<IntegrationAccount[]> => {
    const response = await apiClient.get<IntegrationAccount[]>('/integrations/accounts')
    return response.data
  },

  /** Its links are removed; their sources are kept, or deleted with deleteSources. */
  deleteAccount: async (accountId: string, deleteSources = false): Promise<CloudRemovalResponse> => {
    const response = await apiClient.delete<CloudRemovalResponse>(
      `/integrations/accounts/${accountId}`,
      { params: { delete_sources: deleteSources } }
    )
    return response.data
  },

  /** List remote folders and files; omit parentId for the root. */
  /** Files and folders matching `q` (min 2 chars) by name anywhere in the account. */
  search: async (accountId: string, q: string, limit = 100): Promise<RemoteSearchResponse> => {
    const response = await apiClient.get<RemoteSearchResponse>(
      `/integrations/accounts/${accountId}/search`,
      { params: { q, limit } }
    )
    return response.data
  },

  browse: async (accountId: string, parentId?: string): Promise<BrowseResponse> => {
    const params = parentId ? { parent_id: parentId } : {}
    const response = await apiClient.get<BrowseResponse>(
      `/integrations/accounts/${accountId}/browse`,
      { params }
    )
    return response.data
  },

  // Links (a linked cloud file or folder)
  listLinks: async (notebookId?: string): Promise<SyncLink[]> => {
    const params = notebookId ? { notebook_id: notebookId } : {}
    const response = await apiClient.get<SyncLink[]>('/integrations/links', { params })
    return response.data
  },

  importLinks: async (data: ImportLinksRequest): Promise<ImportLinksResponse> => {
    const response = await apiClient.post<ImportLinksResponse>('/integrations/links/import', data)
    return response.data
  },

  updateLink: async (id: string, data: UpdateLinkRequest): Promise<SyncLink> => {
    const response = await apiClient.put<SyncLink>(`/integrations/links/${id}`, data)
    return response.data
  },

  /** Stops and removes the link; its sources stay as regular sources unless deleteSources. */
  deleteLink: async (id: string, deleteSources = false): Promise<CloudRemovalResponse> => {
    const response = await apiClient.delete<CloudRemovalResponse>(`/integrations/links/${id}`, {
      params: { delete_sources: deleteSources },
    })
    return response.data
  },

  /** 409 when a sync is already queued/running for the link. */
  syncLink: async (id: string): Promise<TriggerSyncResponse> => {
    const response = await apiClient.post<TriggerSyncResponse>(`/integrations/links/${id}/sync`)
    return response.data
  },

  listLinkFiles: async (id: string): Promise<SyncedFile[]> => {
    const response = await apiClient.get<SyncedFile[]>(`/integrations/links/${id}/files`)
    return response.data
  },

  // Synced files (per-file controls inside a folder link)
  updateSyncedFile: async (id: string, data: { sync_enabled: boolean }): Promise<SyncedFile> => {
    const response = await apiClient.put<SyncedFile>(`/integrations/synced-files/${id}`, data)
    return response.data
  },

  excludeSyncedFile: async (id: string, deleteSource: boolean): Promise<SyncedFile> => {
    const response = await apiClient.post<SyncedFile>(`/integrations/synced-files/${id}/exclude`, {
      delete_source: deleteSource,
    })
    return response.data
  },

  bulkSyncedFiles: async (
    fileIds: string[],
    action: SyncedFileBulkAction
  ): Promise<SyncedFilesBulkResponse> => {
    const response = await apiClient.post<SyncedFilesBulkResponse>('/integrations/synced-files/bulk', {
      file_ids: fileIds,
      action,
    })
    return response.data
  },

  includeSyncedFile: async (id: string): Promise<SyncedFile> => {
    const response = await apiClient.post<SyncedFile>(`/integrations/synced-files/${id}/include`)
    return response.data
  },

  // Per-source
  getSourceMap: async (): Promise<SourceCloudMap> => {
    const response = await apiClient.get<SourceCloudMap>('/integrations/source-map')
    return response.data
  },

  /** 404 when the source was not imported from cloud storage. */
  getSourceCloudInfo: async (sourceId: string): Promise<SourceCloudInfo> => {
    const response = await apiClient.get<SourceCloudInfo>(`/integrations/sources/${sourceId}`)
    return response.data
  },

  /** File link: toggles the link. Source from a folder link: toggles that file only. */
  updateSourceSync: async (sourceId: string, syncEnabled: boolean): Promise<SourceCloudInfo> => {
    const response = await apiClient.put<SourceCloudInfo>(`/integrations/sources/${sourceId}/sync`, {
      sync_enabled: syncEnabled,
    })
    return response.data
  },

  /** Stop syncing the source for good; it stays as a regular source unless deleteSource. */
  disconnectSource: async (sourceId: string, deleteSource: boolean): Promise<CloudRemovalResponse> => {
    const response = await apiClient.post<CloudRemovalResponse>(
      `/integrations/sources/${sourceId}/disconnect`,
      { delete_source: deleteSource }
    )
    return response.data
  },

  /** Runs the source's link sync now; 409 when already queued/running. */
  syncSource: async (sourceId: string): Promise<TriggerSyncResponse> => {
    const response = await apiClient.post<TriggerSyncResponse>(`/integrations/sources/${sourceId}/sync`)
    return response.data
  },
}
