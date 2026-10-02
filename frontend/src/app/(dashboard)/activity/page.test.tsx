import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ActivityPage from './page'
import { useActivity } from '@/lib/hooks/use-activity'
import { sourcesApi } from '@/lib/api/sources'
import type { ActivityJob, ActivityResponse } from '@/lib/api/activity'

// useTranslation is mocked globally in setup.ts (t returns the key string).

vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const mockCancelJob = vi.fn()
const mockCancelTarget = vi.fn()
const mockDismissJob = vi.fn()
const mockDismissFinished = vi.fn()

vi.mock('@/lib/hooks/use-activity', () => ({
  useActivity: vi.fn(),
  useCancelJob: () => ({ mutate: mockCancelJob, isPending: false }),
  useCancelTarget: () => ({ mutate: mockCancelTarget, isPending: false }),
  useDismissJob: () => ({ mutate: mockDismissJob, isPending: false }),
  useDismissFinished: () => ({ mutate: mockDismissFinished, isPending: false }),
}))

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: { retry: vi.fn() },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockUseActivity = vi.mocked(useActivity)
const mockRetry = vi.mocked(sourcesApi.retry)

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

function job(overrides: Partial<ActivityJob>): ActivityJob {
  return {
    id: 'command:1',
    name: 'process_source',
    stage: 'extraction',
    status: 'running',
    created: iso(5_000),
    started_at: iso(4_000),
    finished_at: null,
    error: null,
    target_type: 'source',
    target_id: 'source:a',
    target_title: 'Alpha',
    target_exists: true,
    detail: null,
    retryable: false,
    cancel_requested: false,
    ...overrides,
  }
}

function mockData(data: Partial<ActivityResponse>) {
  const response: ActivityResponse = {
    active: [],
    recent: [],
    counts: { active: 0, queued: 0, running: 0, failed_recent: 0 },
    ...data,
  }
  mockUseActivity.mockReturnValue({
    data: response,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useActivity>)
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ActivityPage />
    </QueryClientProvider>,
  )
}

describe('ActivityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('groups active jobs of the same target into one card', () => {
    mockData({
      active: [
        job({ id: 'command:1', stage: 'extraction', target_id: 'source:a', target_title: 'Alpha' }),
        job({ id: 'command:2', stage: 'transformation', status: 'new', started_at: null, detail: 'Summary', target_id: 'source:a', target_title: 'Alpha' }),
        job({ id: 'command:3', stage: 'embedding', target_id: 'source:b', target_title: 'Beta' }),
        job({ id: 'command:4', stage: 'rebuild_embeddings', target_type: null, target_id: null, target_title: null }),
      ],
      counts: { active: 4, queued: 1, running: 3, failed_recent: 0 },
    })

    renderPage()

    const groups = screen.getAllByTestId('activity-group')
    expect(groups).toHaveLength(3)

    const alpha = groups[0]
    expect(within(alpha).getByText('Alpha').closest('a')?.getAttribute('href')).toBe(
      `/sources/${encodeURIComponent('source:a')}`,
    )
    expect(within(alpha).getAllByTestId('activity-active-job')).toHaveLength(2)
    expect(within(alpha).getByText('activity.stages.extraction')).toBeDefined()
    expect(within(alpha).getByText('activity.stages.transformation')).toBeDefined()
    expect(within(alpha).getByText('Summary')).toBeDefined()
    expect(within(alpha).getByText('activity.waitingForWorker')).toBeDefined()

    expect(within(groups[1]).getAllByTestId('activity-active-job')).toHaveLength(1)
    expect(within(groups[2]).getByText('activity.system')).toBeDefined()
  })

  it('shows deleted targets muted without a link', () => {
    mockData({
      recent: [
        job({ status: 'completed', finished_at: iso(1_000), target_exists: false, target_title: 'Gone' }),
      ],
    })

    renderPage()

    expect(screen.getByText('Gone').closest('a')).toBeNull()
    expect(screen.getByText('activity.deleted')).toBeDefined()
  })

  it('calls the retry API for a retryable failed job', async () => {
    mockRetry.mockResolvedValue({} as Awaited<ReturnType<typeof sourcesApi.retry>>)
    mockData({
      recent: [
        job({
          id: 'command:9',
          status: 'failed',
          finished_at: iso(1_000),
          error: 'Extraction exploded',
          retryable: true,
          target_id: 'source:x',
          target_title: 'Broken',
        }),
        job({ id: 'command:10', status: 'completed', finished_at: iso(2_000), target_id: 'source:y', target_title: 'Fine' }),
      ],
      counts: { active: 0, queued: 0, running: 0, failed_recent: 1 },
    })

    renderPage()

    expect(screen.getByText('Extraction exploded')).toBeDefined()
    const retryButtons = screen.getAllByRole('button', { name: 'activity.retry' })
    expect(retryButtons).toHaveLength(1)

    fireEvent.click(retryButtons[0])

    await waitFor(() => expect(mockRetry).toHaveBeenCalledWith('source:x'))
  })

  it('filters the recent list to failures only', () => {
    mockData({
      recent: [
        job({ id: 'command:1', status: 'failed', finished_at: iso(1_000), target_id: 'source:x', target_title: 'Broken' }),
        job({ id: 'command:2', status: 'completed', finished_at: iso(2_000), target_id: 'source:y', target_title: 'Fine' }),
      ],
    })

    renderPage()
    expect(screen.getByText('Fine')).toBeDefined()

    fireEvent.click(screen.getByRole('checkbox', { name: 'activity.onlyFailures' }))

    expect(screen.queryByText('Fine')).toBeNull()
    expect(screen.getByText('Broken')).toBeDefined()
  })

  it('warns that the worker may be down when jobs are only queued for a while', () => {
    mockData({
      active: [job({ status: 'new', created: iso(5 * 60_000), started_at: null })],
      counts: { active: 1, queued: 1, running: 0, failed_recent: 0 },
    })

    renderPage()

    expect(screen.getByTestId('activity-worker-warning')).toBeDefined()
    expect(screen.getByText('activity.workerWarning')).toBeDefined()
  })

  it('does not warn when queued jobs are recent or something is running', () => {
    mockData({
      active: [
        job({ id: 'command:1', status: 'running' }),
        job({ id: 'command:2', status: 'new', created: iso(5 * 60_000), started_at: null }),
      ],
      counts: { active: 2, queued: 1, running: 1, failed_recent: 0 },
    })

    renderPage()

    expect(screen.queryByTestId('activity-worker-warning')).toBeNull()
  })

  it('renders empty states when there is no activity', () => {
    mockData({})

    renderPage()

    expect(screen.getByText('activity.noActive')).toBeDefined()
    expect(screen.getByText('activity.noRecent')).toBeDefined()
  })

  describe('stopping and removing jobs', () => {
    beforeEach(() => {
      mockCancelJob.mockReset()
      mockCancelTarget.mockReset()
      mockDismissJob.mockReset()
      mockDismissFinished.mockReset()
    })

    it('stops a single running job', () => {
      mockData({ active: [job({ id: 'command:run' })], counts: { active: 1, queued: 0, running: 1, failed_recent: 0 } })
      renderPage()
      fireEvent.click(screen.getByRole('button', { name: 'activity.stop' }))
      expect(mockCancelJob).toHaveBeenCalledWith('command:run')
    })

    it('shows a stopping job without a stop button', () => {
      mockData({ active: [job({ cancel_requested: true })], counts: { active: 1, queued: 0, running: 1, failed_recent: 0 } })
      renderPage()
      expect(screen.getByText('activity.statusStopping')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'activity.stop' })).not.toBeInTheDocument()
      expect(screen.queryByText('activity.stopAll')).not.toBeInTheDocument()
    })

    it('stops all jobs of a source, and deletes it after confirmation', () => {
      mockData({
        active: [job({ id: 'command:1' }), job({ id: 'command:2', stage: 'embedding', status: 'new' })],
        counts: { active: 2, queued: 1, running: 1, failed_recent: 0 },
      })
      renderPage()

      fireEvent.click(screen.getByText('activity.stopAll'))
      expect(mockCancelTarget.mock.calls[0][0]).toEqual({
        target_type: 'source', target_id: 'source:a', delete_target: false,
      })

      fireEvent.click(screen.getByRole('button', { name: /activity.stopAndDelete/ }))
      const dialog = screen.getByRole('alertdialog')
      fireEvent.click(within(dialog).getByRole('button', { name: /activity.stopAndDelete/ }))
      expect(mockCancelTarget.mock.calls[1][0]).toEqual({
        target_type: 'source', target_id: 'source:a', delete_target: true,
      })
    })

    it('removes finished jobs from the list, one or all', () => {
      mockData({ recent: [job({ id: 'command:done', status: 'completed', finished_at: iso(1000) })] })
      renderPage()
      fireEvent.click(screen.getByRole('button', { name: 'activity.dismiss' }))
      expect(mockDismissJob).toHaveBeenCalledWith('command:done')
      fireEvent.click(screen.getByText('activity.clearFinished'))
      expect(mockDismissFinished).toHaveBeenCalledWith(24)
    })
  })
})
