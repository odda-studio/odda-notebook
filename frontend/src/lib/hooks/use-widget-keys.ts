import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { QUERY_KEYS } from '@/lib/api/query-client'
import {
  widgetKeysApi,
  CreateWidgetKeyRequest,
  UpdateWidgetKeyRequest,
} from '@/lib/api/widget-keys'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorMessage } from '@/lib/utils/error-handler'

export function useWidgetKeys(notebookId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: QUERY_KEYS.widgetKeys(notebookId),
    queryFn: () => widgetKeysApi.list(notebookId),
    enabled: !!notebookId && (options?.enabled ?? true),
  })
}

function useWidgetKeyMutationHelpers() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { t } = useTranslation()

  return {
    invalidate: () => queryClient.invalidateQueries({ queryKey: ['widget-keys'] }),
    success: (descriptionKey: string) =>
      toast({ title: t('common.success'), description: t(descriptionKey) }),
    error: (error: unknown) =>
      toast({
        title: t('common.error'),
        description: getApiErrorMessage(error, (key) => t(key)),
        variant: 'destructive',
      }),
  }
}

export function useCreateWidgetKey(notebookId: string) {
  const h = useWidgetKeyMutationHelpers()
  return useMutation({
    mutationFn: (data: CreateWidgetKeyRequest) => widgetKeysApi.create(notebookId, data),
    onSuccess: () => {
      h.invalidate()
      h.success('widget.createSuccess')
    },
    onError: h.error,
  })
}

export function useUpdateWidgetKey() {
  const h = useWidgetKeyMutationHelpers()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateWidgetKeyRequest }) =>
      widgetKeysApi.update(id, data),
    onSuccess: () => {
      h.invalidate()
      h.success('widget.updateSuccess')
    },
    onError: h.error,
  })
}

export function useRegenerateWidgetKey() {
  const h = useWidgetKeyMutationHelpers()
  return useMutation({
    mutationFn: (id: string) => widgetKeysApi.regenerate(id),
    onSuccess: () => {
      h.invalidate()
      h.success('widget.regenerateSuccess')
    },
    onError: h.error,
  })
}

export function useDeleteWidgetKey() {
  const h = useWidgetKeyMutationHelpers()
  return useMutation({
    mutationFn: (id: string) => widgetKeysApi.delete(id),
    onSuccess: () => {
      h.invalidate()
      h.success('widget.deleteSuccess')
    },
    onError: h.error,
  })
}
