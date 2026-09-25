import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BrowseResponse, RemoteItem } from '@/lib/api/integrations'
import { CloudPicker, CloudPickerValue, EMPTY_CLOUD_PICKER_VALUE } from './CloudPicker'

// useTranslation is mocked globally in setup.ts (t returns the key string)

// Radix Select measures its trigger via ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

function item(overrides: Partial<RemoteItem>): RemoteItem {
  return {
    id: 'id',
    name: 'name',
    path: '/name',
    kind: 'file',
    size: 1024,
    modified_at: null,
    mime_type: null,
    extension: 'pdf',
    eligible: true,
    web_url: null,
    ...overrides,
  }
}

const LISTINGS: Record<string, BrowseResponse> = {
  root: {
    parent_id: '',
    path: '/',
    items: [
      item({ id: 'id:folder', name: 'Research', path: '/Research', kind: 'folder', size: null }),
      item({ id: 'id:a', name: 'a.pdf', path: '/a.pdf' }),
      item({ id: 'id:big', name: 'huge.mov', path: '/huge.mov', eligible: false }),
      item({
        id: 'virtual:shared-with-me', name: 'Shared with me', path: '/Shared with me',
        kind: 'folder', size: null, selectable: false,
      }),
    ],
  },
  'virtual:shared-with-me': {
    parent_id: 'virtual:shared-with-me',
    path: '/Shared with me',
    selectable: false,
    items: [item({ id: 'id:team', name: 'Team', path: '/Shared with me/Team', kind: 'folder', size: null })],
  },
  'id:folder': {
    parent_id: 'id:folder',
    path: '/Research',
    items: [item({ id: 'id:b', name: 'b.docx', path: '/Research/b.docx' })],
  },
}

vi.mock('@/lib/hooks/use-integrations', () => ({
  useIntegrationAccounts: () => ({
    isLoading: false,
    data: [
      {
        id: 'integration_account:1',
        provider: 'dropbox',
        name: 'Ada',
        account_email: null,
        sync_folder_count: 0,
        created: '',
        updated: '',
      },
    ],
  }),
  useRemoteBrowse: (_accountId: string, parentId?: string) => ({
    isLoading: false,
    isError: false,
    error: null,
    data: LISTINGS[parentId ?? 'root'],
  }),
}))

let latest: CloudPickerValue = EMPTY_CLOUD_PICKER_VALUE
function Harness() {
  const [value, setValue] = useState<CloudPickerValue>(EMPTY_CLOUD_PICKER_VALUE)
  latest = value
  return <CloudPicker value={value} onChange={setValue} />
}

describe('CloudPicker', () => {
  it('keeps a multi-selection of files and folders across folder navigation', () => {
    render(<Harness />)

    // The only account is preselected and its root listed
    fireEvent.click(screen.getByRole('checkbox', { name: 'a.pdf' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Research' }))

    // Navigate into the folder and pick a file there
    fireEvent.click(screen.getByTitle('integrations.openFolder'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'b.docx' }))

    expect(latest.accountId).toBe('integration_account:1')
    expect(latest.items.map(i => [i.kind, i.remote_id])).toEqual([
      ['file', 'id:a'],
      ['folder', 'id:folder'],
      ['file', 'id:b'],
    ])

    const summary = screen.getByTestId('cloud-picker-selection')
    expect(within(summary).getByText('a.pdf')).toBeInTheDocument()
    expect(within(summary).getByText('b.docx')).toBeInTheDocument()

    // Back to root via the breadcrumb: earlier picks are still ticked
    fireEvent.click(screen.getByRole('button', { name: /integrations.rootFolder/ }))
    expect(screen.getByRole('checkbox', { name: 'a.pdf' })).toBeChecked()

    // Removing from the summary unticks it
    fireEvent.click(within(summary).getAllByRole('button', { name: 'integrations.removeFromSelection' })[0])
    expect(latest.items.map(i => i.remote_id)).toEqual(['id:folder', 'id:b'])
    expect(screen.getByRole('checkbox', { name: 'a.pdf' })).not.toBeChecked()
  })

  it('shows ineligible files disabled with a hint', () => {
    render(<Harness />)
    const big = screen.getByRole('checkbox', { name: 'huge.mov' })
    expect(big).toBeDisabled()
    expect(screen.getByText('integrations.fileNotEligible')).toBeInTheDocument()
    fireEvent.click(big)
    expect(latest.items).toEqual([])
  })

  it('selects the current folder (root uses the provider root id)', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'integrations.selectCurrentFolder' }))
    expect(latest.items).toEqual([
      { kind: 'folder', remote_id: '', remote_path: '/', name: 'integrations.rootFolder' },
    ])
  })

  it('opens virtual "shared with me" groupings but never selects them', () => {
    render(<Harness />)

    const virtualCheckbox = screen.getByRole('checkbox', { name: 'Shared with me' })
    expect(virtualCheckbox).toBeDisabled()

    fireEvent.click(screen.getByTitle('integrations.virtualFolderHint'))
    expect(screen.getByText('Team')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /integrations.selectCurrentFolder/ })).toBeDisabled()

    // Folders inside the grouping are selectable
    fireEvent.click(screen.getByRole('checkbox', { name: 'Team' }))
    expect(latest.items.map(i => i.remote_id)).toEqual(['id:team'])
  })
})
