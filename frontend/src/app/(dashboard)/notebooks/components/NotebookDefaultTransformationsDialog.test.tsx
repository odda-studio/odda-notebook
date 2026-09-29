import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotebookDefaultTransformationsDialog } from './NotebookDefaultTransformationsDialog'
import { NotebookResponse } from '@/lib/types/api'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const mutateAsync = vi.fn()
vi.mock('@/lib/hooks/use-notebooks', () => ({
  useUpdateNotebook: () => ({ mutateAsync, isPending: false }),
}))

const transformation = (id: string, title: string) => ({
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
const transformationsData = vi.hoisted(() => [] as unknown[])
vi.mock('@/lib/hooks/use-transformations', () => ({
  useTransformations: () => ({ isLoading: false, data: transformationsData }),
  useTransformationGroups: () => ({ isLoading: false, data: [] }),
}))

const notebook: NotebookResponse = {
  id: 'notebook:1',
  name: 'Thesis',
  description: '',
  archived: false,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
  source_count: 0,
  note_count: 0,
  default_transformations: ['transformation:summary', 'transformation:deleted'],
}

describe('NotebookDefaultTransformationsDialog', () => {
  beforeEach(() => {
    mutateAsync.mockReset().mockResolvedValue(notebook)
    transformationsData.splice(
      0,
      transformationsData.length,
      transformation('transformation:summary', 'Summary'),
      transformation('transformation:keypoints', 'Key points')
    )
  })

  it('saves the selected transformation ids on the notebook', async () => {
    const onOpenChange = vi.fn()
    render(
      <NotebookDefaultTransformationsDialog notebook={notebook} open onOpenChange={onOpenChange} />
    )

    expect(screen.getByText('notebooks.defaultTransformationsDesc')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Summary' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Key points' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    // Ids of transformations that no longer exist are dropped
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'notebook:1',
      data: { default_transformations: ['transformation:summary', 'transformation:keypoints'] },
    })
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('clears the defaults with an empty list', async () => {
    render(<NotebookDefaultTransformationsDialog notebook={notebook} open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Summary' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        id: 'notebook:1',
        data: { default_transformations: [] },
      })
    )
  })
})
