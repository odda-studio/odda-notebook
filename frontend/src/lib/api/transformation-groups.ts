import apiClient from './client'
import {
  TransformationGroup,
  CreateTransformationGroupRequest,
  UpdateTransformationGroupRequest,
  DeleteTransformationGroupResponse,
} from '@/lib/types/transformations'

export const transformationGroupsApi = {
  list: async () => {
    const response = await apiClient.get<TransformationGroup[]>('/transformation-groups')
    return response.data
  },

  create: async (data: CreateTransformationGroupRequest) => {
    const response = await apiClient.post<TransformationGroup>('/transformation-groups', data)
    return response.data
  },

  update: async (id: string, data: UpdateTransformationGroupRequest) => {
    const response = await apiClient.put<TransformationGroup>(`/transformation-groups/${id}`, data)
    return response.data
  },

  delete: async (id: string, deleteTransformations: boolean) => {
    const response = await apiClient.delete<DeleteTransformationGroupResponse>(
      `/transformation-groups/${id}`,
      { params: { delete_transformations: deleteTransformations } }
    )
    return response.data
  },
}
