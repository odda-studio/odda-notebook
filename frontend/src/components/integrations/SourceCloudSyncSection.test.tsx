import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourceCloudInfo } from '@/lib/api/integrations'
import { SourceCloudSyncSection } from './SourceCloudSyncSection'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const updateMutate = vi.fn()
const syncMutate = vi.fn()
const disconnectMutate = vi.fn()
let entry: SourceCloudInfo | undefined

vi.mock('@/lib/hooks/use-integrations', () => ({
  useSourceCloudEntry: () => entry,
  useSourceCloudInfo: () => ({ data: undefined }),
  useUpdateSourceSync: () => ({ isPending: false, mutate: updateMutate }),
  useTriggerSourceSync: () => ({ isPending: false, mutate: syncMutate }),
  useDisconnectSource: () => ({ isPending: false, mutate: disconnectMutate }),
}))

function makeInfo(overrides: Partial<SourceCloudInfo> = {}): SourceCloudInfo {
  return {
    source_id: 'source:1',
    provider: 'google_drive',
    account_name: 'Ada',
    link_id: 'sync_link:1',
    link_kind: 'folder',
    link_name: 'Research',
    synced_file_id: 'synced_file:1',
    sync_enabled: true,
    link_sync_enabled: true,
    file_sync_enabled: true,
    file_status: 'synced',
    link_status: 'idle',
    last_sync_at: null,
    last_error: null,
    remote_path: '/Research/paper.pdf',
    web_url: 'https://drive.google.com/file/d/1',
    ...overrides,
  }
}

describe('SourceCloudSyncSection', () => {
  beforeEach(() => {
    updateMutate.mockReset()
    syncMutate.mockReset()
    disconnectMutate.mockReset()
  })

  it('renders nothing for sources that are not cloud-imported', () => {
    entry = undefined
    const { container } = render(<SourceCloudSyncSection sourceId="source:1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('toggles sync for this source only when it comes from a folder link', () => {
    entry = makeInfo()
    render(<SourceCloudSyncSection sourceId="source:1" />)

    expect(screen.getByText('integrations.sourceSyncFolderHint')).toBeInTheDocument()
    expect(screen.getByText('/Research/paper.pdf')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /integrations.openInDrive/ })).toHaveAttribute(
      'href',
      'https://drive.google.com/file/d/1'
    )

    const toggle = screen.getByRole('checkbox', { name: 'integrations.keepSourceInSync' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(updateMutate).toHaveBeenCalledWith({ sourceId: 'source:1', syncEnabled: false })
  })

  it('explains file links and triggers Sync now', () => {
    entry = makeInfo({ link_kind: 'file', sync_enabled: false, link_sync_enabled: false })
    render(<SourceCloudSyncSection sourceId="source:1" />)

    expect(screen.getByText('integrations.sourceSyncFileHint')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'integrations.keepSourceInSync' }))
    expect(updateMutate).toHaveBeenCalledWith({ sourceId: 'source:1', syncEnabled: true })

    fireEvent.click(screen.getByRole('button', { name: /integrations.syncNow/ }))
    expect(syncMutate).toHaveBeenCalledWith('source:1')
  })

  it('disconnects the source, optionally deleting it, and closes the view when deleted', () => {
    entry = makeInfo()
    const onSourceDeleted = vi.fn()
    disconnectMutate.mockImplementation((_vars, opts) => opts.onSuccess({ sources_deleted: 1 }))
    render(<SourceCloudSyncSection sourceId="source:1" onSourceDeleted={onSourceDeleted} />)

    fireEvent.click(screen.getByRole('button', { name: /integrations.disconnectSource/ }))
    expect(screen.getByText('integrations.disconnectSourceFolderConfirm')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'integrations.alsoDeleteThisSource' }))
    const confirm = screen
      .getAllByRole('button', { name: /integrations.disconnectSource/ })
      .find(b => b.closest('[role="dialog"]'))
    fireEvent.click(confirm!)

    expect(disconnectMutate.mock.calls[0][0]).toEqual({ sourceId: 'source:1', deleteSource: true })
    expect(onSourceDeleted).toHaveBeenCalled()
  })
})
