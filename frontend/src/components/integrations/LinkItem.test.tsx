import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncLink } from '@/lib/api/integrations'
import { LinkItem } from './LinkItem'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const updateMutate = vi.fn()
const syncMutate = vi.fn()

vi.mock('@/lib/hooks/use-integrations', () => ({
  useUpdateLink: () => ({ isPending: false, mutate: updateMutate }),
  useDeleteLink: () => ({ isPending: false, mutate: vi.fn() }),
  useTriggerLinkSync: () => ({ isPending: false, mutate: syncMutate }),
}))

vi.mock('./SyncedFileList', () => ({
  SyncedFileList: () => <div data-testid="synced-file-list" />,
}))
vi.mock('./LinkEditDialog', () => ({ LinkEditDialog: () => null }))

function makeLink(overrides: Partial<SyncLink> = {}): SyncLink {
  return {
    id: 'sync_link:1',
    account_id: 'integration_account:1',
    provider: 'dropbox',
    account_name: 'Ada',
    kind: 'folder',
    remote_id: 'id:folder',
    remote_path: '/Research',
    name: 'Research',
    web_url: 'https://www.dropbox.com/home/Research',
    notebook_ids: ['notebook:1', 'notebook:2'],
    notebook_names: ['Thesis', 'Reading'],
    recursive: true,
    interval_minutes: 30,
    transformations: [],
    sync_enabled: true,
    status: 'idle',
    last_sync_at: null,
    next_sync_at: null,
    last_error: null,
    file_count: 3,
    ...overrides,
  }
}

describe('LinkItem', () => {
  beforeEach(() => {
    updateMutate.mockReset()
    syncMutate.mockReset()
  })

  it('shows notebook badges and toggles sync_enabled', () => {
    render(<LinkItem link={makeLink()} />)
    expect(screen.getByText('Thesis')).toBeInTheDocument()
    expect(screen.getByText('Reading')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'integrations.keepInSync' }))
    expect(updateMutate).toHaveBeenCalledWith({
      id: 'sync_link:1',
      data: { sync_enabled: false },
    })

    fireEvent.click(screen.getByRole('button', { name: /integrations.syncNow/ }))
    expect(syncMutate).toHaveBeenCalledWith('sync_link:1')

    // Folder links expose their file list
    fireEvent.click(screen.getByText('integrations.showFiles'))
    expect(screen.getByTestId('synced-file-list')).toBeInTheDocument()
  })

  it('labels links without notebooks as general sources and hides the file list for files', () => {
    render(<LinkItem link={makeLink({ kind: 'file', notebook_ids: [], notebook_names: [] })} />)
    expect(screen.getByText('integrations.generalSources')).toBeInTheDocument()
    expect(screen.queryByText('integrations.showFiles')).not.toBeInTheDocument()
  })

  it('disables Sync now while a sync is running', () => {
    render(<LinkItem link={makeLink({ status: 'running' })} />)
    expect(screen.getByRole('button', { name: /integrations.syncNow/ })).toBeDisabled()
  })
})
