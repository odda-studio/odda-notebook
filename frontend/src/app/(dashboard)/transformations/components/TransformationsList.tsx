'use client'

import { ReactNode, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, ChevronRight, FolderPlus, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import { TransformationCard } from './TransformationCard'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Transformation, TransformationGroup } from '@/lib/types/transformations'
import { TransformationEditorDialog } from './TransformationEditorDialog'
import { TransformationGroupDialog } from './TransformationGroupDialog'
import { DeleteTransformationGroupDialog } from './DeleteTransformationGroupDialog'
import { groupTransformations } from '@/lib/utils/transformation-groups'
import { useTranslation } from '@/lib/hooks/use-translation'

interface TransformationsListProps {
  transformations: Transformation[] | undefined
  groups?: TransformationGroup[]
  isLoading: boolean
  onPlayground?: (transformation: Transformation) => void
}

interface GroupSectionProps {
  title: string
  count: number
  actions?: ReactNode
  children: ReactNode
  testId: string
}

function GroupSection({ title, count, actions, children, testId }: GroupSectionProps) {
  const [open, setOpen] = useState(true)

  return (
    <Collapsible open={open} onOpenChange={setOpen} data-testid={testId}>
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <h3 className="font-display text-base font-semibold tracking-tight">{title}</h3>
          <span className="font-mono text-xs text-muted-foreground">{count}</span>
        </CollapsibleTrigger>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      <CollapsibleContent className="space-y-4 pt-4">{children}</CollapsibleContent>
    </Collapsible>
  )
}

export function TransformationsList({ transformations, groups, isLoading, onPlayground }: TransformationsListProps) {
  const { t } = useTranslation()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTransformation, setEditingTransformation] = useState<Transformation | undefined>()
  const [editorGroupId, setEditorGroupId] = useState<string | null>(null)
  const [groupDialogOpen, setGroupDialogOpen] = useState(false)
  const [renamingGroup, setRenamingGroup] = useState<TransformationGroup | undefined>()
  const [deletingGroup, setDeletingGroup] = useState<TransformationGroup | undefined>()

  const { sections, ungrouped } = useMemo(
    () => groupTransformations(transformations, groups),
    [transformations, groups]
  )

  const handleOpenEditor = (trans?: Transformation, groupId: string | null = null) => {
    setEditingTransformation(trans)
    setEditorGroupId(groupId)
    setEditorOpen(true)
  }

  const handleOpenGroupDialog = (group?: TransformationGroup) => {
    setRenamingGroup(group)
    setGroupDialogOpen(true)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  const dialogs = (
    <>
      <TransformationEditorDialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) {
            setEditingTransformation(undefined)
            setEditorGroupId(null)
          }
        }}
        transformation={editingTransformation}
        defaultGroupId={editorGroupId}
      />
      <TransformationGroupDialog
        open={groupDialogOpen}
        onOpenChange={(open) => {
          setGroupDialogOpen(open)
          if (!open) setRenamingGroup(undefined)
        }}
        group={renamingGroup}
      />
      <DeleteTransformationGroupDialog
        open={Boolean(deletingGroup)}
        onOpenChange={(open) => {
          if (!open) setDeletingGroup(undefined)
        }}
        group={deletingGroup}
        transformationCount={
          sections.find((section) => section.group.id === deletingGroup?.id)?.items.length ?? 0
        }
      />
    </>
  )

  const newGroupButton = (
    <Button variant="outline" onClick={() => handleOpenGroupDialog()}>
      <FolderPlus className="h-4 w-4 mr-2" />
      {t('transformations.newGroup')}
    </Button>
  )

  if ((!transformations || transformations.length === 0) && sections.length === 0) {
    return (
      <>
        <EmptyState
          icon={Wand2}
          title={t('transformations.noTransformations')}
          description={t('transformations.createOne')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => handleOpenEditor()}>
                <Plus className="h-4 w-4 mr-2" />
                {t('transformations.createNew')}
              </Button>
              {newGroupButton}
            </div>
          }
        />
        {dialogs}
      </>
    )
  }

  const renderCards = (items: Transformation[]) =>
    items.map((transformation) => (
      <TransformationCard
        key={transformation.id}
        transformation={transformation}
        groups={groups}
        onPlayground={onPlayground ? () => onPlayground(transformation) : undefined}
        onEdit={() => handleOpenEditor(transformation)}
      />
    ))

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h2 className="font-display text-lg font-semibold tracking-tight">{t('transformations.listTitle')}</h2>
          <div className="flex items-center gap-2">
            {newGroupButton}
            <Button onClick={() => handleOpenEditor()}>
              <Plus className="h-4 w-4 mr-2" />
              {t('transformations.createNew')}
            </Button>
          </div>
        </div>

        {sections.length === 0 ? (
          <div className="space-y-4">{renderCards(ungrouped)}</div>
        ) : (
          <div className="space-y-8">
            {sections.map(({ group, items }) => (
              <GroupSection
                key={group.id}
                testId={`transformation-group-${group.id}`}
                title={group.name}
                count={items.length}
                actions={
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('transformations.createInGroup')}
                      title={t('transformations.createInGroup')}
                      onClick={() => handleOpenEditor(undefined, group.id)}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('transformations.renameGroup')}
                      title={t('transformations.renameGroup')}
                      onClick={() => handleOpenGroupDialog(group)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      aria-label={t('transformations.deleteGroup')}
                      title={t('transformations.deleteGroup')}
                      onClick={() => setDeletingGroup(group)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                }
              >
                {items.length > 0 ? (
                  renderCards(items)
                ) : (
                  <p className="text-sm text-muted-foreground">{t('transformations.emptyGroup')}</p>
                )}
              </GroupSection>
            ))}

            {ungrouped.length > 0 && (
              <GroupSection
                testId="transformation-group-ungrouped"
                title={t('transformations.ungrouped')}
                count={ungrouped.length}
              >
                {renderCards(ungrouped)}
              </GroupSection>
            )}
          </div>
        )}
      </div>

      {dialogs}
    </>
  )
}
