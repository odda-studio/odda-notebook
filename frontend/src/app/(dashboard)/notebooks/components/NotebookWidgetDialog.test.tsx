import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotebookWidgetDialog } from './NotebookWidgetDialog'
import { NotebookResponse } from '@/lib/types/api'
import { WidgetKey } from '@/lib/api/widget-keys'

const createMutateAsync = vi.fn()
const regenerateMutateAsync = vi.fn()
const keysData = vi.hoisted(() => [] as unknown[])

vi.mock('@/lib/hooks/use-widget-keys', () => ({
  useWidgetKeys: () => ({ data: keysData, isLoading: false }),
  useCreateWidgetKey: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateWidgetKey: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useRegenerateWidgetKey: () => ({ mutateAsync: regenerateMutateAsync, isPending: false }),
  useDeleteWidgetKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/config', () => ({ getApiUrl: () => Promise.resolve('https://api.example.com') }))
vi.mock('@/lib/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const notebook: NotebookResponse = {
  id: 'notebook:abc',
  name: 'Thesis',
  description: '',
  archived: false,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
  source_count: 0,
  note_count: 0,
  default_transformations: [],
}

const existingKey: WidgetKey = {
  id: 'widget_key:1',
  notebook_id: 'notebook:abc',
  name: 'Site',
  key_prefix: 'onw_AbCdEf',
  enabled: true,
  allowed_origins: [],
  rate_limit_per_minute: 20,
  daily_limit: 0,
  created: '2026-01-01T00:00:00Z',
  last_used_at: null,
}

describe('NotebookWidgetDialog', () => {
  beforeEach(() => {
    createMutateAsync.mockReset()
    regenerateMutateAsync.mockReset()
    keysData.splice(0, keysData.length)
  })

  it('shows the one-time key and a snippet with the notebook id and key after create', async () => {
    createMutateAsync.mockResolvedValue({
      ...existingKey,
      id: 'widget_key:new',
      name: 'New',
      key: 'onw_FULLKEY123',
    })
    render(<NotebookWidgetDialog notebook={notebook} open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByText('widget.createKey'))
    fireEvent.change(screen.getByLabelText('widget.keyName'), { target: { value: 'New' } })
    fireEvent.click(screen.getByText('common.save'))

    await waitFor(() => expect(screen.getByTestId('widget-created-key')).toBeInTheDocument())
    expect(createMutateAsync).toHaveBeenCalledWith({
      name: 'New',
      allowed_origins: [],
      rate_limit_per_minute: 20,
      daily_limit: 0,
    })
    expect(screen.getByTestId('widget-created-key')).toHaveTextContent('onw_FULLKEY123')
    expect(screen.getByText('widget.copyNow')).toBeInTheDocument()

    await waitFor(() => {
      const snippet = screen.getByTestId('widget-snippet-floating').textContent ?? ''
      expect(snippet).toContain('notebook-id="notebook:abc"')
      expect(snippet).toContain('widget-key="onw_FULLKEY123"')
      expect(snippet).toContain('api-url="https://api.example.com"')
    })
  })

  it('shows the empty-origins warning in the form', () => {
    render(<NotebookWidgetDialog notebook={notebook} open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByText('widget.createKey'))
    expect(screen.getByText('widget.anyOriginWarning')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('widget.allowedOrigins'), {
      target: { value: 'https://example.com' },
    })
    expect(screen.queryByText('widget.anyOriginWarning')).not.toBeInTheDocument()
  })

  it('shows the "any origin" badge and placeholder key for an existing key', async () => {
    keysData.push(existingKey)
    render(<NotebookWidgetDialog notebook={notebook} open onOpenChange={vi.fn()} />)
    expect(screen.getByText('widget.anyOrigin')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('widget-snippet-floating').textContent).toContain(
        'widget-key="YOUR_WIDGET_KEY"'
      )
    )
  })

  it('asks for confirmation before regenerating', async () => {
    keysData.push(existingKey)
    regenerateMutateAsync.mockResolvedValue({ ...existingKey, key: 'onw_NEWKEY' })
    render(<NotebookWidgetDialog notebook={notebook} open onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByText('widget.regenerate'))
    expect(screen.getByText('widget.regenerateConfirmTitle')).toBeInTheDocument()
    expect(regenerateMutateAsync).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('common.confirm'))
    await waitFor(() => expect(regenerateMutateAsync).toHaveBeenCalledWith('widget_key:1'))
    await waitFor(() =>
      expect(screen.getByTestId('widget-created-key')).toHaveTextContent('onw_NEWKEY')
    )
  })
})
