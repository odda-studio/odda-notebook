import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TransformationsList } from './TransformationsList'
import { Transformation, TransformationGroup } from '@/lib/types/transformations'

// useTranslation is mocked globally in setup.ts (t returns the key string)

vi.mock('./TransformationEditorDialog', () => ({
  TransformationEditorDialog: ({ open, defaultGroupId }: { open: boolean; defaultGroupId?: string | null }) =>
    open ? (
      <div data-testid="transformation-editor-dialog" data-group={defaultGroupId ?? ''} />
    ) : null,
}))

vi.mock('./TransformationGroupDialog', () => ({
  TransformationGroupDialog: ({ open, group }: { open: boolean; group?: TransformationGroup }) =>
    open ? <div data-testid="transformation-group-dialog" data-group={group?.id ?? ''} /> : null,
}))

vi.mock('./DeleteTransformationGroupDialog', () => ({
  DeleteTransformationGroupDialog: ({
    open,
    group,
    transformationCount,
  }: {
    open: boolean
    group?: TransformationGroup
    transformationCount: number
  }) =>
    open ? (
      <div data-testid="delete-group-dialog" data-group={group?.id} data-count={transformationCount} />
    ) : null,
}))

vi.mock('./TransformationCard', () => ({
  TransformationCard: ({ transformation }: { transformation: Transformation }) => (
    <div data-testid="transformation-card">{transformation.name}</div>
  ),
}))

const makeTransformation = (id: string, name: string, groupId: string | null = null): Transformation => ({
  id,
  name,
  title: name,
  description: `${name} description`,
  prompt: 'Prompt',
  apply_default: false,
  model_id: null,
  max_tokens: null,
  group_id: groupId,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
})

const makeGroup = (id: string, name: string, count = 0): TransformationGroup => ({
  id,
  name,
  transformation_count: count,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
})

const mockTransformation = makeTransformation('transformation:1', 'summarize')

describe('TransformationsList', () => {
  it('opens the editor dialog from the empty state create button', () => {
    render(<TransformationsList transformations={[]} isLoading={false} />)

    fireEvent.click(screen.getByText('transformations.createNew'))

    expect(screen.getByTestId('transformation-editor-dialog')).toBeInTheDocument()
  })

  it('opens the editor dialog from the list header create button', () => {
    render(<TransformationsList transformations={[mockTransformation]} isLoading={false} />)

    fireEvent.click(screen.getByText('transformations.createNew'))

    expect(screen.getByTestId('transformation-editor-dialog')).toBeInTheDocument()
  })

  it('renders a flat list without group sections when there are no groups', () => {
    render(<TransformationsList transformations={[mockTransformation]} groups={[]} isLoading={false} />)

    expect(screen.getByText('summarize')).toBeInTheDocument()
    expect(screen.queryByTestId('transformation-group-ungrouped')).not.toBeInTheDocument()
  })

  it('renders one section per group sorted by name, empty groups, and Ungrouped last', () => {
    const groups = [makeGroup('transformation_group:b', 'Beta', 1), makeGroup('transformation_group:a', 'Alpha', 1), makeGroup('transformation_group:e', 'Empty')]
    const transformations = [
      makeTransformation('transformation:1', 'in-alpha', 'transformation_group:a'),
      makeTransformation('transformation:2', 'in-beta', 'transformation_group:b'),
      makeTransformation('transformation:3', 'loose'),
    ]

    render(<TransformationsList transformations={transformations} groups={groups} isLoading={false} />)

    const alpha = screen.getByTestId('transformation-group-transformation_group:a')
    const beta = screen.getByTestId('transformation-group-transformation_group:b')
    const empty = screen.getByTestId('transformation-group-transformation_group:e')
    const ungrouped = screen.getByTestId('transformation-group-ungrouped')

    expect(within(alpha).getByText('Alpha')).toBeInTheDocument()
    expect(within(alpha).getByText('in-alpha')).toBeInTheDocument()
    expect(within(beta).getByText('in-beta')).toBeInTheDocument()
    expect(within(empty).getByText('transformations.emptyGroup')).toBeInTheDocument()
    expect(within(ungrouped).getByText('transformations.ungrouped')).toBeInTheDocument()
    expect(within(ungrouped).getByText('loose')).toBeInTheDocument()

    // Section order: Alpha, Beta, Empty, then Ungrouped
    const sections = screen.getAllByTestId(/^transformation-group-/)
    expect(sections).toEqual([alpha, beta, empty, ungrouped])
  })

  it('hides the Ungrouped section when every transformation is grouped', () => {
    const groups = [makeGroup('transformation_group:a', 'Alpha', 1)]
    const transformations = [makeTransformation('transformation:1', 'in-alpha', 'transformation_group:a')]

    render(<TransformationsList transformations={transformations} groups={groups} isLoading={false} />)

    expect(screen.queryByTestId('transformation-group-ungrouped')).not.toBeInTheDocument()
  })

  it('preselects the group when creating from a group header', () => {
    const groups = [makeGroup('transformation_group:a', 'Alpha')]

    render(<TransformationsList transformations={[]} groups={groups} isLoading={false} />)

    fireEvent.click(screen.getByLabelText('transformations.createInGroup'))

    expect(screen.getByTestId('transformation-editor-dialog')).toHaveAttribute(
      'data-group',
      'transformation_group:a'
    )
  })

  it('opens the new-group, rename and delete dialogs', () => {
    const groups = [makeGroup('transformation_group:a', 'Alpha', 2)]
    const transformations = [
      makeTransformation('transformation:1', 'one', 'transformation_group:a'),
      makeTransformation('transformation:2', 'two', 'transformation_group:a'),
    ]

    render(<TransformationsList transformations={transformations} groups={groups} isLoading={false} />)

    fireEvent.click(screen.getByText('transformations.newGroup'))
    expect(screen.getByTestId('transformation-group-dialog')).toHaveAttribute('data-group', '')

    fireEvent.click(screen.getByLabelText('transformations.renameGroup'))
    expect(screen.getByTestId('transformation-group-dialog')).toHaveAttribute(
      'data-group',
      'transformation_group:a'
    )

    fireEvent.click(screen.getByLabelText('transformations.deleteGroup'))
    const deleteDialog = screen.getByTestId('delete-group-dialog')
    expect(deleteDialog).toHaveAttribute('data-group', 'transformation_group:a')
    expect(deleteDialog).toHaveAttribute('data-count', '2')
  })
})
