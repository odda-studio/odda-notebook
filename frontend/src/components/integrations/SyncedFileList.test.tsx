import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncedFile } from '@/lib/api/integrations'
import { SyncedFileList } from './SyncedFileList'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const updateMutate = vi.fn()
const includeMutate = vi.fn()
const excludeMutate = vi.fn()
const bulkMutate = vi.fn()
let files: SyncedFile[] = []

vi.mock('@/lib/hooks/use-integrations', () => ({
  useLinkFiles: () => ({ data: files, isLoading: false, isError: false, error: null }),
  useUpdateSyncedFile: () => ({ isPending: false, mutate: updateMutate }),
  useIncludeSyncedFile: () => ({ isPending: false, mutate: includeMutate }),
  useExcludeSyncedFile: () => ({ isPending: false, mutate: excludeMutate }),
  useBulkSyncedFiles: () => ({ isPending: false, mutate: bulkMutate }),
}))

function makeFile(overrides: Partial<SyncedFile>): SyncedFile {
  return {
    id: 'synced_file:1',
    link_id: 'sync_link:1',
    remote_id: 'id:a',
    name: 'a.pdf',
    path: '/Research/a.pdf',
    source_id: 'source:a',
    status: 'synced',
    sync_enabled: true,
    last_error: null,
    remote_modified_at: null,
    updated: null,
    web_url: 'https://www.dropbox.com/a.pdf',
    ...overrides,
  }
}

describe('SyncedFileList', () => {
  beforeEach(() => {
    updateMutate.mockReset()
    includeMutate.mockReset()
    excludeMutate.mockReset()
    bulkMutate.mockReset()
  })

  it('toggles per-file sync, links to the source and includes excluded files', () => {
    files = [
      makeFile({}),
      makeFile({ id: 'synced_file:2', name: 'b.pdf', status: 'excluded', source_id: null }),
    ]
    render(<SyncedFileList linkId="sync_link:1" provider="dropbox" />)

    // Only the non-excluded file has a sync toggle
    const toggles = screen.getAllByRole('checkbox', { name: 'integrations.fileSyncToggle' })
    expect(toggles).toHaveLength(1)
    fireEvent.click(toggles[0])
    expect(updateMutate).toHaveBeenCalledWith({ id: 'synced_file:1', syncEnabled: false })

    expect(screen.getByRole('link', { name: 'integrations.openSource' })).toHaveAttribute(
      'href',
      '/sources/source%3Aa'
    )

    fireEvent.click(screen.getByRole('button', { name: /integrations.includeFile/ }))
    expect(includeMutate).toHaveBeenCalledWith('synced_file:2')
  })

  it('asks whether to delete the source when excluding a file', () => {
    files = [makeFile({})]
    render(<SyncedFileList linkId="sync_link:1" provider="dropbox" />)

    fireEvent.click(screen.getByRole('button', { name: /integrations.excludeFile/ }))
    expect(screen.getByText('integrations.excludeFileTitle')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'integrations.excludeDeleteSource' }))

    const confirm = screen
      .getAllByRole('button', { name: /integrations.excludeFile/ })
      .find(b => b.closest('[role="dialog"]'))
    fireEvent.click(confirm!)
    expect(excludeMutate).toHaveBeenCalledWith(
      { id: 'synced_file:1', deleteSource: true },
      expect.anything()
    )
  })

  it('applies bulk actions to the selected files, deleting sources after confirmation', () => {
    files = [
      makeFile({}),
      makeFile({ id: 'synced_file:2', name: 'b.pdf', source_id: 'source:b' }),
      makeFile({ id: 'synced_file:3', name: 'c.pdf', source_id: null }),
    ]
    render(<SyncedFileList linkId="sync_link:1" provider="dropbox" />)

    fireEvent.click(screen.getAllByRole('checkbox', { name: 'integrations.selectFile' })[0])
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'integrations.selectFile' })[2])
    fireEvent.click(screen.getByRole('button', { name: /integrations.bulkDisconnect/ }))
    expect(bulkMutate.mock.calls[0][0]).toEqual({
      fileIds: ['synced_file:1', 'synced_file:3'],
      action: 'disconnect',
    })

    fireEvent.click(screen.getByRole('button', { name: /integrations.bulkDelete/ }))
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'integrations.bulkDelete')!
    )
    expect(bulkMutate.mock.calls[1][0]).toEqual({
      fileIds: ['synced_file:1', 'synced_file:3'],
      action: 'delete',
    })
  })
})
