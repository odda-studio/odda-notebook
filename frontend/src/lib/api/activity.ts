import apiClient from './client'
import type { LlmUsage } from '@/lib/types/llm-usage'

export type ActivityStage =
  | 'extraction'
  | 'transformation'
  | 'insight'
  | 'embedding'
  | 'insight_embedding'
  | 'note_embedding'
  | 'cloud_sync'
  | 'podcast'
  | 'rebuild_embeddings'
  | 'other'

/** `new` = queued, waiting for the worker to pick it up. */
export type ActivityJobStatus = 'new' | 'running' | 'completed' | 'failed' | 'canceled'

export type ActivityTargetType = 'source' | 'note' | 'link' | 'podcast'

/** What a job is doing right now, reported by the worker. */
export interface ActivityProgress {
  /** Step code, translated with STEP_LABEL_KEYS (unknown codes shown as-is). */
  step: string
  /** File name, model, counts… */
  detail: string | null
  current: number | null
  total: number | null
  at: string | null
}

export interface ActivityJob {
  id: string
  name: string
  stage: ActivityStage
  status: ActivityJobStatus
  created: string | null
  started_at: string | null
  finished_at: string | null
  error: string | null
  target_type: ActivityTargetType | null
  target_id: string | null
  target_title: string | null
  target_exists: boolean
  /**
   * Transformation title (run_transformation), insight type (create_insight),
   * or — for process_source — the number of transformations queued with it.
   */
  detail: string | null
  /** Failed process_source whose source still exists: POST /sources/{id}/retry. */
  retryable: boolean
  /** Stop requested; a running job shows as "stopping" until it actually ends. */
  cancel_requested: boolean
  /** Live step of a queued/running job (null once finished). */
  progress: ActivityProgress | null
  /** Execution attempts so far (retries included). */
  attempts: number
  /** Every LLM call made by the job, oldest first. */
  llm_usage: LlmUsage[]
}

export interface ActivityJobDetail extends ActivityJob {
  /** Job input, long texts truncated. */
  args: Record<string, unknown>
  /** Job output once finished, long texts truncated. */
  result: Record<string, unknown> | null
  full_error: string | null
  /** One entry per step, oldest first. */
  progress_log: ActivityProgress[]
  cancel_requested_at: string | null
  /** Names of the notebooks the job works for. */
  notebooks: string[]
}

/** Exactly one selector. */
export type CancelJobsSelection =
  | { job_ids: string[] }
  | { stage: ActivityStage }
  | { all: true }

export interface CancelJobsResponse {
  /** Jobs flagged for cancellation. */
  canceled: number
  /** Of those, the ones that were running and are stopping. */
  stopping: number
  deleted_target: boolean
}

export interface ActivityCounts {
  active: number
  queued: number
  running: number
  failed_recent: number
}

export interface ActivityResponse {
  /** Queued/running jobs, oldest first. */
  active: ActivityJob[]
  /** Finished within `hours`, newest first. */
  recent: ActivityJob[]
  counts: ActivityCounts
}

export const activityApi = {
  list: async (params?: { hours?: number; limit?: number }) => {
    const response = await apiClient.get<ActivityResponse>('/activity', { params })
    return response.data
  },

  summary: async (params?: { hours?: number }) => {
    const response = await apiClient.get<ActivityCounts>('/activity/summary', { params })
    return response.data
  },

  /** Everything about one job (input, output, live step, timeline). */
  getJob: async (jobId: string) => {
    const response = await apiClient.get<ActivityJobDetail>(`/activity/jobs/${jobId}`)
    return response.data
  },

  /** Stop a selection of jobs, every job of a stage, or everything. */
  cancelJobs: async (selection: CancelJobsSelection) => {
    const response = await apiClient.post<CancelJobsResponse>('/activity/cancel', selection)
    return response.data
  },

  /** Stop one queued/running job (400 if it already finished). */
  cancelJob: async (jobId: string) => {
    const response = await apiClient.post<CancelJobsResponse>(`/activity/jobs/${jobId}/cancel`)
    return response.data
  },

  /** Stop every job working on a source or cloud link; optionally delete the source. */
  cancelTarget: async (data: {
    target_type: 'source' | 'link'
    target_id: string
    delete_target?: boolean
  }) => {
    const response = await apiClient.post<CancelJobsResponse>('/activity/targets/cancel', data)
    return response.data
  },

  /** Hide one finished job from the list (400 if still active). */
  dismissJob: async (jobId: string) => {
    const response = await apiClient.post<{ dismissed: number }>(`/activity/jobs/${jobId}/dismiss`)
    return response.data
  },

  /** Hide every finished job of the window. */
  dismissFinished: async (hours: number) => {
    const response = await apiClient.post<{ dismissed: number }>('/activity/dismiss-finished', null, {
      params: { hours },
    })
    return response.data
  },
}
