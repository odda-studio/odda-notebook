import apiClient from './client'

export interface WidgetKey {
  id: string
  notebook_id: string
  name: string
  key_prefix: string
  enabled: boolean
  /** Exact origins (scheme://host[:port]). Empty = any origin. */
  allowed_origins: string[]
  rate_limit_per_minute: number
  /** 0 = unlimited */
  daily_limit: number
  created: string
  last_used_at: string | null
}

/** Returned only by create/regenerate: `key` is the full key and is never shown again. */
export interface WidgetKeyCreated extends WidgetKey {
  key: string
}

export interface CreateWidgetKeyRequest {
  name: string
  allowed_origins?: string[]
  rate_limit_per_minute?: number
  daily_limit?: number
}

export type UpdateWidgetKeyRequest = Partial<{
  name: string
  enabled: boolean
  allowed_origins: string[]
  rate_limit_per_minute: number
  daily_limit: number
}>

export const widgetKeysApi = {
  list: async (notebookId: string) => {
    const response = await apiClient.get<WidgetKey[]>(`/notebooks/${notebookId}/widget-keys`)
    return response.data
  },

  create: async (notebookId: string, data: CreateWidgetKeyRequest) => {
    const response = await apiClient.post<WidgetKeyCreated>(
      `/notebooks/${notebookId}/widget-keys`,
      data
    )
    return response.data
  },

  update: async (id: string, data: UpdateWidgetKeyRequest) => {
    const response = await apiClient.put<WidgetKey>(`/widget-keys/${id}`, data)
    return response.data
  },

  regenerate: async (id: string) => {
    const response = await apiClient.post<WidgetKeyCreated>(`/widget-keys/${id}/regenerate`)
    return response.data
  },

  delete: async (id: string) => {
    const response = await apiClient.delete<{ message: string }>(`/widget-keys/${id}`)
    return response.data
  },
}
