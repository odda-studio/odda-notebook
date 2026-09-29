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

// Stable references, like react-query returns (the dialog resets its form
// whenever settings / transformations change identity)
const notebooksData = vi.hoisted(() => [
  { id: 'notebook:1', name: 'Thesis', description: '', default_transformations: [] },
  {
    id: 'notebook:2',
    name: 'Reading',
    description: '',
    default_transformations: ['transformation:summary', 'transformation:keypoints'],
  },
])
vi.mock('@/lib/hooks/use-notebooks', () => ({
  useNotebooks: () => ({ isLoading: false, data: notebooksData }),
}))

const transformationFixture = (id: string, title: string) => ({
  id,
  name: title,
  title,
  description: '',
  prompt: '',
  apply_default: false,
  model_id: null,
  group_id: null,
  created: '',
  updated: '',
})
let transformationsData: ReturnType<typeof transformationFixture>[] = []

vi.mock('@/lib/hooks/use-transformations', () => ({
  useTransformations: () => ({ isLoading: false, data: transformationsData }),
  useTransformationGroups: () => ({ isLoading: false, data: [] }),
}))
const settingsData = { default_embedding_option: 'ask' }
vi.mock('@/lib/hooks/use-settings', () => ({
  useSettings: () => ({ data: settingsData }),
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
    transformationsData = []
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
    expect(screen.getByText('sources.cloudNotebookDefaultsHint')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.done' }))

    await waitFor(() => expect(importMutateAsync).toHaveBeenCalledTimes(1))
    expect(importMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'integration_account:1',
        notebook_ids: ['notebook:1', 'notebook:2'],
        sync_enabled: true,
        recursive: true,
        // Cloud imports apply the notebooks' defaults server side
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

describe('AddSourceDialog — notebook default transformations', () => {
  beforeEach(() => {
    transformationsData = [
      transformationFixture('transformation:summary', 'Summary'),
      transformationFixture('transformation:keypoints', 'Key points'),
      transformationFixture('transformation:other', 'Other'),
    ]
    importMutateAsync.mockReset()
    createMutateAsync.mockReset().mockResolvedValue({})
  })

  it('preselects the selected notebooks\' defaults and sends the explicit list', async () => {
    render(<AddSourceDialog open onOpenChange={vi.fn()} defaultNotebookId="notebook:1" />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: /sources.enterText/ }), { button: 0 })
    fireEvent.change(screen.getByLabelText('sources.textContentLabel'), {
      target: { value: 'Hello' },
    })
    fireEvent.change(screen.getByPlaceholderText('sources.titlePlaceholder'), {
      target: { value: 'Note' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))

    // Selecting a notebook adds its defaults
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reading' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))

    expect(screen.getByText('sources.notebookDefaultsPreselected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Summary' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Key points' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Other' })).not.toBeChecked()

    // Unticking a default keeps it unticked; a manual pick is added
    fireEvent.click(screen.getByRole('checkbox', { name: 'Key points' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }))
    expect(screen.getByRole('checkbox', { name: 'Key points' })).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'common.done' }))

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1))
    const request = createMutateAsync.mock.calls[0][0]
    expect(request).toMatchObject({
      type: 'text',
      notebooks: ['notebook:1', 'notebook:2'],
      apply_notebook_defaults: false,
    })
    expect([...request.transformations].sort()).toEqual([
      'transformation:other',
      'transformation:summary',
    ])
  })

  it('does not show the hint when the selected notebooks have no defaults', () => {
    render(<AddSourceDialog open onOpenChange={vi.fn()} defaultNotebookId="notebook:1" />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: /sources.enterText/ }), { button: 0 })
    fireEvent.change(screen.getByLabelText('sources.textContentLabel'), {
      target: { value: 'Hello' },
    })
    fireEvent.change(screen.getByPlaceholderText('sources.titlePlaceholder'), {
      target: { value: 'Note' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.next' }))

    expect(screen.queryByText('sources.notebookDefaultsPreselected')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Summary' })).not.toBeChecked()
  })
})
