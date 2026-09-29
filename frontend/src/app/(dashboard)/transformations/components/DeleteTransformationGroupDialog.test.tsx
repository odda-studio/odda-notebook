import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DeleteTransformationGroupDialog } from './DeleteTransformationGroupDialog'
import { transformationGroupsApi } from '@/lib/api/transformation-groups'
import { TransformationGroup } from '@/lib/types/transformations'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('@/lib/api/transformation-groups', () => ({
  transformationGroupsApi: {
    delete: vi.fn(),
  },
}))

const mockDelete = vi.mocked(transformationGroupsApi.delete)

const group: TransformationGroup = {
  id: 'transformation_group:a',
  name: 'Alpha',
  transformation_count: 3,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
}

function renderDialog(onOpenChange = vi.fn(), transformationCount = 3) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <DeleteTransformationGroupDialog
        open
        onOpenChange={onOpenChange}
        group={group}
        transformationCount={transformationCount}
      />
    </QueryClientProvider>
  )
  return onOpenChange
}

describe('DeleteTransformationGroupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDelete.mockResolvedValue({ message: 'ok', deleted_transformations: 0, ungrouped_transformations: 3 })
  })

  it('keeps the transformations by default (delete_transformations=false)', async () => {
    const onOpenChange = renderDialog()

    expect(screen.getByText('transformations.deleteGroupKeep')).toBeInTheDocument()
    fireEvent.click(screen.getByText('common.delete'))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('transformation_group:a', false))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('deletes the transformations too when chosen (delete_transformations=true)', async () => {
    mockDelete.mockResolvedValue({ message: 'ok', deleted_transformations: 3, ungrouped_transformations: 0 })
    renderDialog()

    const radios = screen.getAllByRole('radio')
    fireEvent.click(radios[1])
    fireEvent.click(screen.getByText('common.delete'))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('transformation_group:a', true))
  })

  it('does not ask about transformations for an empty group', async () => {
    renderDialog(vi.fn(), 0)

    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('common.delete'))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('transformation_group:a', false))
  })
})
