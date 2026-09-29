import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAddSourcesToNotebook } from './use-sources'
import { notebooksApi } from '@/lib/api/notebooks'

vi.mock('@/lib/api/notebooks', () => ({
  notebooksApi: { addSource: vi.fn() },
}))

const toast = vi.fn()
vi.mock('@/lib/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)

describe('useAddSourcesToNotebook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports the notebook default transformations queued by the server', async () => {
    vi.mocked(notebooksApi.addSource)
      .mockResolvedValueOnce({ message: 'ok', applied_transformations: ['transformation:a'] })
      .mockResolvedValueOnce({
        message: 'ok',
        applied_transformations: ['transformation:a', 'transformation:b'],
      })

    const { result } = renderHook(() => useAddSourcesToNotebook(), { wrapper })
    await act(() =>
      result.current.mutateAsync({ notebookId: 'notebook:1', sourceIds: ['source:1', 'source:2'] })
    )

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'sources.sourcesAddedToNotebook' })
    )
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'sources.defaultTransformationsQueued' })
    )
  })

  it('shows no queued toast when nothing was applied', async () => {
    vi.mocked(notebooksApi.addSource).mockResolvedValue({
      message: 'ok',
      applied_transformations: [],
    })

    const { result } = renderHook(() => useAddSourcesToNotebook(), { wrapper })
    await act(() =>
      result.current.mutateAsync({ notebookId: 'notebook:1', sourceIds: ['source:1'] })
    )

    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ description: 'sources.defaultTransformationsQueued' })
    )
  })
})
