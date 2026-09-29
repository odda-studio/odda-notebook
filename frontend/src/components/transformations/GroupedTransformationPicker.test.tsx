import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { GroupedTransformationPicker } from './GroupedTransformationPicker'
import { Transformation, TransformationGroup } from '@/lib/types/transformations'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const makeTransformation = (id: string, name: string, groupId: string | null = null): Transformation => ({
  id,
  name,
  title: name,
  description: '',
  prompt: 'Prompt',
  apply_default: false,
  model_id: null,
  group_id: groupId,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
})

const groups: TransformationGroup[] = [
  {
    id: 'transformation_group:legal',
    name: 'Legal',
    transformation_count: 2,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
  },
]

const transformations = [
  makeTransformation('transformation:1', 'Clauses', 'transformation_group:legal'),
  makeTransformation('transformation:2', 'Parties', 'transformation_group:legal'),
  makeTransformation('transformation:3', 'Summary'),
]

const groupCheckbox = () => screen.getByLabelText('transformations.selectWholeGroup')

describe('GroupedTransformationPicker', () => {
  it('renders a flat list when there are no groups', () => {
    render(
      <GroupedTransformationPicker
        transformations={transformations.map((tr) => ({ ...tr, group_id: null }))}
        groups={[]}
        selectedIds={[]}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByText('Clauses')).toBeInTheDocument()
    expect(screen.queryByText('transformations.ungrouped')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('transformations.selectWholeGroup')).not.toBeInTheDocument()
  })

  it('selects every member of a group from the group checkbox', () => {
    const onChange = vi.fn()
    render(
      <GroupedTransformationPicker
        transformations={transformations}
        groups={groups}
        selectedIds={['transformation:3']}
        onChange={onChange}
      />
    )

    expect(screen.getByText('Legal')).toBeInTheDocument()
    expect(screen.getByText('transformations.ungrouped')).toBeInTheDocument()
    expect(groupCheckbox()).toHaveAttribute('data-state', 'unchecked')

    fireEvent.click(groupCheckbox())

    expect(onChange).toHaveBeenCalledWith(['transformation:3', 'transformation:1', 'transformation:2'])
  })

  it('shows indeterminate on partial selection and completes the group on click', () => {
    const onChange = vi.fn()
    render(
      <GroupedTransformationPicker
        transformations={transformations}
        groups={groups}
        selectedIds={['transformation:1']}
        onChange={onChange}
      />
    )

    expect(groupCheckbox()).toHaveAttribute('data-state', 'indeterminate')
    expect(groupCheckbox()).toHaveAttribute('aria-checked', 'mixed')

    fireEvent.click(groupCheckbox())

    expect(onChange).toHaveBeenCalledWith(['transformation:1', 'transformation:2'])
  })

  it('deselects every member when the whole group is selected', () => {
    const onChange = vi.fn()
    render(
      <GroupedTransformationPicker
        transformations={transformations}
        groups={groups}
        selectedIds={['transformation:1', 'transformation:3', 'transformation:2']}
        onChange={onChange}
      />
    )

    expect(groupCheckbox()).toHaveAttribute('data-state', 'checked')

    fireEvent.click(groupCheckbox())

    expect(onChange).toHaveBeenCalledWith(['transformation:3'])
  })

  it('toggles a single transformation inside a group', () => {
    const onChange = vi.fn()
    render(
      <GroupedTransformationPicker
        transformations={transformations}
        groups={groups}
        selectedIds={['transformation:1']}
        onChange={onChange}
      />
    )

    // Group is expanded because it has a selected member
    fireEvent.click(screen.getByText('Parties'))

    expect(onChange).toHaveBeenCalledWith(['transformation:1', 'transformation:2'])
  })
})
