import { Transformation, TransformationGroup } from '@/lib/types/transformations'

export interface TransformationGroupSection<T extends Pick<Transformation, 'group_id'> = Transformation> {
  group: TransformationGroup
  items: T[]
}

export interface GroupedTransformations<T extends Pick<Transformation, 'group_id'> = Transformation> {
  /** One section per group, sorted by name (empty groups included). */
  sections: TransformationGroupSection<T>[]
  /** Transformations with no group, or whose group is unknown. */
  ungrouped: T[]
}

/**
 * Groups transformations client-side (the API returns them flat, by name).
 * Input ordering is preserved within each section.
 */
export function groupTransformations<T extends Pick<Transformation, 'group_id'>>(
  transformations: T[] | undefined,
  groups: TransformationGroup[] | undefined
): GroupedTransformations<T> {
  const sortedGroups = [...(groups ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
  const byId = new Map<string, TransformationGroupSection<T>>()
  const sections = sortedGroups.map((group) => {
    const section = { group, items: [] as T[] }
    byId.set(group.id, section)
    return section
  })
  const ungrouped: T[] = []

  for (const transformation of transformations ?? []) {
    const section = transformation.group_id ? byId.get(transformation.group_id) : undefined
    if (section) {
      section.items.push(transformation)
    } else {
      ungrouped.push(transformation)
    }
  }

  return { sections, ungrouped }
}
