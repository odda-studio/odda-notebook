"use client"

import { useMemo } from "react"
import { SelectGroup, SelectItem, SelectLabel, SelectSeparator } from "@/components/ui/select"
import { useTranslation } from "@/lib/hooks/use-translation"
import { Transformation, TransformationGroup } from "@/lib/types/transformations"
import { groupTransformations } from "@/lib/utils/transformation-groups"

interface GroupedTransformationSelectItemsProps {
  transformations: Transformation[] | undefined
  groups?: TransformationGroup[]
  getLabel?: (transformation: Transformation) => string
}

/**
 * The options of a single-select transformation <Select>, grouped: groups by
 * name first, then ungrouped ones. Renders flat when there are no groups.
 * Place inside <SelectContent>.
 */
export function GroupedTransformationSelectItems({
  transformations,
  groups,
  getLabel = (transformation) => transformation.name,
}: GroupedTransformationSelectItemsProps) {
  const { t } = useTranslation()
  const { sections, ungrouped } = useMemo(
    () => groupTransformations(transformations, groups),
    [transformations, groups]
  )
  const filledSections = sections.filter((section) => section.items.length > 0)

  const renderItem = (transformation: Transformation) => (
    <SelectItem key={transformation.id} value={transformation.id}>
      {getLabel(transformation)}
    </SelectItem>
  )

  if (filledSections.length === 0) {
    return <>{ungrouped.map(renderItem)}</>
  }

  return (
    <>
      {filledSections.map(({ group, items }, index) => (
        <SelectGroup key={group.id}>
          {index > 0 && <SelectSeparator />}
          <SelectLabel>{group.name}</SelectLabel>
          {items.map(renderItem)}
        </SelectGroup>
      ))}
      {ungrouped.length > 0 && (
        <SelectGroup>
          <SelectSeparator />
          <SelectLabel>{t("transformations.ungrouped")}</SelectLabel>
          {ungrouped.map(renderItem)}
        </SelectGroup>
      )}
    </>
  )
}
