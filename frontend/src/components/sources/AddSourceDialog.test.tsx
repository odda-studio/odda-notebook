import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudPickerValue } from '@/components/integrations/CloudPicker'
import { AddSourceDialog } from './AddSourceDialog'

// useTranslation is mocked globally in setup.ts (t returns the key string)

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const importMutateAsync = vi.fn()
const createMutateAsync = vi.fn()

vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebooks: () => ({
    isLoading: false,
    data: [
      { id: 'notebook:1', name: 'Thesis', description: '' },
      { id: 'notebook:2', name: 'Reading', description: '' },
    ],
  }),
}))
vi.mock('@/lib/hooks/use-transformations', () => ({
  useTransformations: () => ({ isLoading: false, data: [] }),
  useTransformationGroups: () => ({ isLoading: false, data: [] }),
}))
vi.mock('@/lib/hooks/use-settings', () => ({
  useSettings: () => ({ data: { default_embedding_option: 'ask' } }),
}))
vi.mock('@/lib/hooks/use-sources', () => ({
  useCreateSource: () => ({ isPending: false, mutateAsync: createMutateAsync }),
}))
vi.mock('@/lib/hooks/use-integrations', () => ({
  useImportLinks: () => ({ isPending: false, mutateAsync: importMutateAsync }),
}))

// Replace the picker panel with a button that makes a selection; the request
// building / validation helpers stay real.
vi.mock('@/components/integrations/CloudImportPanel', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/integrations/CloudImportPanel')>()
  return {
    ...actual,
    CloudImportPanel: ({ onSelectionChange }: { onSelectionChange: (v: CloudPickerValue) => void }) => (
      <button
        type="button"
        onClick={() =>
          onSelectionChange({
            accountId: 'integration_account:1',
            items: [
              { kind: 'folder', remote_id: 'id:folder', remote_path: '/Research', name: 'Research' },
              { kind: 'file', remote_id: 'id:a', remote_path: '/a.pdf', name: 'a.pdf' },
            ],
          })
        }
      >
        fake-pick
      </button>
    ),
  }
})

describe('AddSourceDialog — Cloud', () => {
  beforeEach(() => {
    importMutateAsync.mockReset().mockResolvedValue({ links: [], reused_sources: 0 })
    createMutateAsync.mockReset()
  })

  it('imports the picked cloud items into the selected notebooks via /links/import', async () => {
    const onOpenChange = vi.fn()
    render(<AddSourceDialog open onOpenChange={onOpenChange} defaultNotebookId="notebook:1" />)

    // Radix tabs activate on mousedown
    fireEvent.mouseDown(screen.getByRole('tab', { name: /sources.cloudStorage/ }), { button: 0 })

    const next = screen.getByRole('button', { name: 'common.next' })
    expect(next).toBeDisabled() // nothing picked yet
    fireEvent.click(screen.getByRole('button', { name: 'fake-pick' }))
    expect(next).toBeEnabled()
    fireEvent.click(next)

    // Notebooks step: the current notebook is preselected; add another one
    expect(screen.getByRole('checkbox', { name: 'Thesis' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reading' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))

    // Processing step: embedding choice doesn't apply to cloud imports
    expect(screen.queryByText('sources.enableEmbedding')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.done' }))

    await waitFor(() => expect(importMutateAsync).toHaveBeenCalledTimes(1))
    expect(importMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'integration_account:1',
        notebook_ids: ['notebook:1', 'notebook:2'],
        sync_enabled: true,
        recursive: true,
        transformations: [],
        items: [
          { kind: 'folder', remote_id: 'id:folder', remote_path: '/Research', name: 'Research' },
          { kind: 'file', remote_id: 'id:a', remote_path: '/a.pdf', name: 'a.pdf' },
        ],
      })
    )
    expect(createMutateAsync).not.toHaveBeenCalled()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('keeps the regular text source path working', async () => {
    render(<AddSourceDialog open onOpenChange={vi.fn()} />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: /sources.enterText/ }), { button: 0 })
    fireEvent.change(screen.getByLabelText('sources.textContentLabel'), {
      target: { value: 'Hello' },
    })
    fireEvent.change(screen.getByPlaceholderText('sources.titlePlaceholder'), {
      target: { value: 'Note' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.done' }))

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1))
    expect(createMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text', content: 'Hello', title: 'Note', notebooks: [] })
    )
    expect(importMutateAsync).not.toHaveBeenCalled()
  })
})
