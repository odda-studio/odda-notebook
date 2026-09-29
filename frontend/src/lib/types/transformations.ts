export interface Transformation {
  id: string
  name: string
  title: string
  description: string
  prompt: string
  apply_default: boolean
  model_id: string | null
  /** null = ungrouped */
  group_id: string | null
  created: string
  updated: string
}

export interface CreateTransformationRequest {
  name: string
  title: string
  description: string
  prompt: string
  apply_default?: boolean
  model_id?: string | null
  /** null/omitted = ungrouped */
  group_id?: string | null
}

export interface UpdateTransformationRequest {
  name?: string
  title?: string
  description?: string
  prompt?: string
  apply_default?: boolean
  model_id?: string | null
  /** Explicit null ungroups; omitted leaves the group unchanged. */
  group_id?: string | null
}

export interface ExecuteTransformationRequest {
  transformation_id: string
  input_text: string
  model_id?: string | null
}

export interface ExecuteTransformationResponse {
  output: string
  transformation_id: string
  model_id: string | null
}

export interface DefaultPrompt {
  transformation_instructions: string
}


export interface TransformationGroup {
  id: string
  name: string
  transformation_count: number
  created: string
  updated: string
}

export interface CreateTransformationGroupRequest {
  name: string
}

export interface UpdateTransformationGroupRequest {
  name: string
}

export interface DeleteTransformationGroupResponse {
  message: string
  deleted_transformations: number
  ungrouped_transformations: number
}
