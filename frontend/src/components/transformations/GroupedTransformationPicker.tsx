"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { CheckboxList } from "@/components/ui/checkbox-list"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useTranslation } from "@/lib/hooks/use-translation"
import { Transformation, TransformationGroup } from "@/lib/types/transformations"
import { groupTransformations } from "@/lib/utils/transformation-groups"
import { cn } from "@/lib/utils"

interface GroupedTransformationPickerProps {
  transformations: Transformation[]
  groups?: TransformationGroup[]
  selectedIds: string[]
  /** Receives the whole new selection. */
  onChange: (ids: string[]) => void
  loading?: boolean
  emptyMessage?: string
  className?: string
}

const displayTitle = (transformation: Transformation) =>
  transformation.title || transformation.name

/**
 * Multi-select of transformations organised by group. Each group header has a
 * tri-state checkbox that selects/deselects all of its members. Without any
 * (non-empty) group it renders the plain flat checklist.
 */
export function GroupedTransformationPicker({
  transformations,
  groups,
  selectedIds,
  onChange,
  loading = false,
  emptyMessage,
  className,
}: GroupedTransformationPickerProps) {
  const { t } = useTranslation()
  const { sections, ungrouped } = useMemo(
    () => groupTransformations(transformations, groups),
    [transformations, groups]
  )
  // Empty groups have nothing to pick.
  const filledSections = sections.filter((section) => section.items.length > 0)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  // Groups start expanded when something in them is already selected.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const isExpanded = (groupId: string, items: Transformation[]) =>
    expanded[groupId] ?? items.some((item) => selected.has(item.id))

  const toggleOne = (id: string) =>
    onChange(selected.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])

  const toggleGroup = (items: Transformation[]) => {
    const ids = items.map((item) => item.id)
    const allSelected = ids.every((id) => selected.has(id))
    if (allSelected) {
      onChange(selectedIds.filter((id) => !ids.includes(id)))
    } else {
      onChange([...selectedIds, ...ids.filter((id) => !selected.has(id))])
    }
  }

  if (loading || filledSections.length === 0) {
    return (
      <CheckboxList
        items={transformations.map((transformation) => ({
          id: transformation.id,
          title: displayTitle(transformation),
          description: transformation.description,
        }))}
        selectedIds={selectedIds}
        onToggle={toggleOne}
        loading={loading}
        emptyMessage={emptyMessage}
        className={className}
      />
    )
  }

  const renderItem = (transformation: Transformation) => (
    <label
      key={transformation.id}
      htmlFor={`checkbox-${transformation.id}`}
      className="flex items-start gap-3 cursor-pointer hover:bg-muted p-2 rounded-md transition-colors"
    >
      <Checkbox
        id={`checkbox-${transformation.id}`}
        name={`checkbox-${transformation.id}`}
        checked={selected.has(transformation.id)}
        onCheckedChange={() => toggleOne(transformation.id)}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium block">{displayTitle(transformation)}</span>
        {transformation.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {transformation.description}
          </p>
        )}
      </div>
    </label>
  )

  return (
    <div className={cn("border border-border rounded-md bg-card", className)}>
      <div className="max-h-72 overflow-y-auto p-2 space-y-1">
        {filledSections.map(({ group, items }) => {
          const selectedCount = items.filter((item) => selected.has(item.id)).length
          const state =
            selectedCount === 0 ? false : selectedCount === items.length ? true : "indeterminate"
          const open = isExpanded(group.id, items)
          const groupCheckboxId = `group-checkbox-${group.id}`

          return (
            <Collapsible
              key={group.id}
              open={open}
              onOpenChange={(value) => setExpanded((prev) => ({ ...prev, [group.id]: value }))}
            >
              <div className="flex items-center gap-2 rounded-md p-2 hover:bg-muted">
                <CollapsibleTrigger
                  type="button"
                  className="text-muted-foreground"
                  aria-label={open ? t("transformations.collapseGroup") : t("transformations.expandGroup")}
                >
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </CollapsibleTrigger>
                <Checkbox
                  id={groupCheckboxId}
                  checked={state}
                  onCheckedChange={() => toggleGroup(items)}
                  aria-label={t("transformations.selectWholeGroup")}
                />
                <label
                  htmlFor={groupCheckboxId}
                  className="flex-1 min-w-0 cursor-pointer text-sm font-semibold"
                >
                  {group.name}
                </label>
                <span className="font-mono text-xs text-muted-foreground">
                  {selectedCount}/{items.length}
                </span>
              </div>
              <CollapsibleContent>
                <div className="ml-6 space-y-1">{items.map(renderItem)}</div>
              </CollapsibleContent>
            </Collapsible>
          )
        })}

        {ungrouped.length > 0 && (
          <div className="pt-1">
            <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("transformations.ungrouped")}
            </p>
            <div className="space-y-1">{ungrouped.map(renderItem)}</div>
          </div>
        )}
      </div>
    </div>
  )
}
