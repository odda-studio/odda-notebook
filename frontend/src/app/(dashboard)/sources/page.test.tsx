import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SourcesPage from './page'
import { sourcesApi } from '@/lib/api/sources'
import { SourceListResponse } from '@/lib/types/api'

// useTranslation is mocked globally in setup.ts (t returns the key string,
// interpolating {{var}} placeholders from the given params)

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/sources/AddSourceDialog', () => ({
  AddSourceDialog: () => null,
}))

vi.mock('@/components/integrations/CloudSourceBadge', () => ({
  CloudSourceBadge: () => null,
}))

vi.mock('@/lib/hooks/use-integrations', () => ({
  useRefreshSourcesAfterSync: () => {},
}))

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: {
    list: vi.fn(),
    count: vi.fn(),
    bulkDelete: vi.fn(),
    delete: vi.fn(),
  },
}))

function source(overrides: Partial<SourceListResponse>): SourceListResponse {
  return {
    id: 'source:1',
    title: 'Untitled',
    topics: [],
    asset: null,
    embedded: false,
    embedded_chunks: 0,
    insights_count: 0,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const mockList = vi.mocked(sourcesApi.list)
const mockCount = vi.mocked(sourcesApi.count)
const mockBulkDelete = vi.mocked(sourcesApi.bulkDelete)

describe('SourcesPage bulk delete', () => {
  const sources = [
    source({ id: 'source:1', title: 'Alpha' }),
    source({ id: 'source:2', title: 'Beta' }),
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    // First call returns the page, subsequent calls (e.g. re-fetch after a
    // bulk delete) return an empty page so infinite-scroll stops.
    mockList.mockResolvedValueOnce(sources).mockResolvedValue([])
  })

  it('enters selection mode, selects rows, and deletes only the selected sources', async () => {
    mockBulkDelete.mockResolvedValue({ deleted: 1, failed: 0, errors: [] })

    render(<SourcesPage />)
    await screen.findByText('Alpha')

    fireEvent.click(screen.getByText('sources.selectSources'))

    // Row checkboxes are now visible; select just the first row.
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1]) // index 0 is the header "select all" checkbox

    expect(screen.getByText('sources.selectedCount')).toBeInTheDocument()

    fireEvent.click(screen.getByText('sources.deleteSelected'))

    // Confirm dialog
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByText('common.delete'))

    await waitFor(() => {
      expect(mockBulkDelete).toHaveBeenCalledWith({ ids: ['source:1'] })
    })
    // Re-syncs with the server after a bulk delete instead of guessing locally
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2))
  })

  it('selects and deselects all loaded rows via the header checkbox', async () => {
    render(<SourcesPage />)
    await screen.findByText('Alpha')

    fireEvent.click(screen.getByText('sources.selectSources'))
    const [headerCheckbox, row1, row2] = screen.getAllByRole('checkbox')

    fireEvent.click(headerCheckbox)
    expect(row1).toBeChecked()
    expect(row2).toBeChecked()

    fireEvent.click(headerCheckbox)
    expect(row1).not.toBeChecked()
    expect(row2).not.toBeChecked()
  })

  it('fetches and shows the total count before confirming "delete all"', async () => {
    mockCount.mockResolvedValue({ count: 123 })
    mockBulkDelete.mockResolvedValue({ deleted: 123, failed: 0, errors: [] })

    render(<SourcesPage />)
    await screen.findByText('Alpha')

    fireEvent.click(screen.getByText('sources.deleteAllSources'))

    const dialog = await screen.findByRole('alertdialog')
    await waitFor(() => expect(mockCount).toHaveBeenCalled())
    await within(dialog).findByText('sources.bulkDeleteAllConfirmCount')

    fireEvent.click(within(dialog).getByText('common.delete'))

    await waitFor(() => {
      expect(mockBulkDelete).toHaveBeenCalledWith({ all: true })
    })
  })

  it('reports a partial failure without losing the successful deletions', async () => {
    mockBulkDelete.mockResolvedValue({
      deleted: 1,
      failed: 1,
      errors: ['source:2: still processing'],
    })

    render(<SourcesPage />)
    await screen.findByText('Alpha')

    fireEvent.click(screen.getByText('sources.selectSources'))
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]) // select all

    fireEvent.click(screen.getByText('sources.deleteSelected'))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByText('common.delete'))

    await waitFor(() => {
      expect(mockBulkDelete).toHaveBeenCalledWith({ ids: ['source:1', 'source:2'] })
    })
    // Selection mode is exited and the list is re-fetched either way
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2))
  })

  it('cancelling selection mode clears the selection', async () => {
    render(<SourcesPage />)
    await screen.findByText('Alpha')

    fireEvent.click(screen.getByText('sources.selectSources'))
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1])
    expect(screen.getByText('sources.selectedCount')).toBeInTheDocument()

    fireEvent.click(screen.getByText('common.cancel'))

    expect(screen.getByText('sources.selectSources')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})
