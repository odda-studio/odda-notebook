'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, ChevronRight, ExternalLink, House, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useIntegrationAccounts, useRemoteBrowse, useRemoteSearch } from '@/lib/hooks/use-integrations'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { cn } from '@/lib/utils'
import type { ImportLinkItem, RemoteItem } from '@/lib/api/integrations'
import {
  formatFileSize,
  LinkKindIcon,
  openInProviderKey,
  ProviderIcon,
  ROOT_FOLDER_IDS,
} from './integration-utils'

/** Backend limit of items per POST /links/import. */
export const MAX_IMPORT_ITEMS = 100

export interface CloudPickerValue {
  accountId: string
  /** Chosen files and folders, kept across folder navigation. */
  items: ImportLinkItem[]
}

export const EMPTY_CLOUD_PICKER_VALUE: CloudPickerValue = { accountId: '', items: [] }

/** A selection can be imported: an account and 1..MAX_IMPORT_ITEMS items. */
export function isCloudSelectionValid(value: CloudPickerValue): boolean {
  return !!value.accountId && value.items.length > 0 && value.items.length <= MAX_IMPORT_ITEMS
}

export function selectionHasFolder(value: CloudPickerValue): boolean {
  return value.items.some(item => item.kind === 'folder')
}

interface Crumb {
  /** undefined = root (parent_id omitted when browsing) */
  id?: string
  name: string
  path: string
}

interface CloudPickerProps {
  value: CloudPickerValue
  onChange: (value: CloudPickerValue) => void
  idPrefix?: string
}

/** Case- and accent-insensitive form used by the folder filter. */
export function normalizeForFilter(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

const SEARCH_MIN_CHARS = 2
const SEARCH_DEBOUNCE_MS = 350

function toImportItem(item: RemoteItem): ImportLinkItem {
  return { kind: item.kind, remote_id: item.id, remote_path: item.path, name: item.name }
}

export function CloudPicker({ value, onChange, idPrefix = 'cloud-picker' }: CloudPickerProps) {
  const { t } = useTranslation()
  const { data: accounts, isLoading: accountsLoading } = useIntegrationAccounts()
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  // Text typed in the search box: filters the open folder instantly, and is
  // the query of the account-wide search when that mode is on.
  const [filter, setFilter] = useState('')
  const [accountSearch, setAccountSearch] = useState(false)
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(filter.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [filter])

  // Preselect the only connected account
  useEffect(() => {
    if (!value.accountId && accounts?.length === 1) {
      onChange({ accountId: accounts[0].id, items: [] })
    }
  }, [accounts, value.accountId, onChange])

  const account = useMemo(
    () => accounts?.find(a => a.id === value.accountId),
    [accounts, value.accountId]
  )

  const rootCrumb: Crumb = { id: undefined, name: t('integrations.rootFolder'), path: '/' }
  // Virtual groupings come from the API with English names: translate them
  const displayName = (item: { id: string; name: string }) =>
    item.id === 'virtual:shared-with-me'
      ? t('integrations.sharedWithMe')
      : item.id === 'virtual:shared-drives'
        ? t('integrations.sharedDrives')
        : item.name

  const trail = [rootCrumb, ...crumbs]
  const current = trail[trail.length - 1]

  const {
    data: listing,
    isLoading: listingLoading,
    isError: listingError,
    error: listingErrorObj,
  } = useRemoteBrowse(value.accountId, current.id, !!account)

  const searching = accountSearch && debouncedQuery.length >= SEARCH_MIN_CHARS
  const {
    data: searchResult,
    isFetching: searchLoading,
    isError: searchError,
    error: searchErrorObj,
  } = useRemoteSearch(value.accountId, debouncedQuery, !!account && searching)

  const normalizedFilter = normalizeForFilter(filter)
  const visibleItems = useMemo(() => {
    if (searching) return searchResult?.items ?? []
    const items = listing?.items ?? []
    if (!normalizedFilter) return items
    return items.filter(item => normalizeForFilter(item.name).includes(normalizedFilter))
  }, [searching, searchResult, listing, normalizedFilter])

  /** Navigating anywhere leaves the search: the box then filters that folder. */
  const navigate = (next: Crumb[]) => {
    setCrumbs(next)
    setFilter('')
    setAccountSearch(false)
  }

  const selectedIds = useMemo(() => new Set(value.items.map(i => i.remote_id)), [value.items])

  const toggleItem = (item: ImportLinkItem) => {
    const items = selectedIds.has(item.remote_id)
      ? value.items.filter(i => i.remote_id !== item.remote_id)
      : [...value.items, item]
    onChange({ ...value, items })
  }

  const removeItem = (remoteId: string) =>
    onChange({ ...value, items: value.items.filter(i => i.remote_id !== remoteId) })

  const handleAccountChange = (accountId: string) => {
    // Items belong to one account: switching starts a new selection
    navigate([])
    onChange({ accountId, items: [] })
  }

  if (accountsLoading) {
    return (
      <div className="flex justify-center py-6">
        <LoadingSpinner />
      </div>
    )
  }

  if (!accounts || accounts.length === 0) {
    return (
      <div className="rounded-md border p-4 text-sm space-y-2">
        <p className="text-muted-foreground">{t('integrations.pickerNoAccounts')}</p>
        <Link href="/settings/integrations" className="text-primary hover:underline">
          {t('integrations.goToIntegrations')}
        </Link>
      </div>
    )
  }

  const currentFolderItem: ImportLinkItem | null = account
    ? {
        kind: 'folder',
        remote_id: current.id ?? ROOT_FOLDER_IDS[account.provider],
        remote_path: listing?.path || current.path,
        name: current.id === undefined ? t('integrations.rootFolder') : current.name,
      }
    : null
  const currentIsSelected = !!currentFolderItem && selectedIds.has(currentFolderItem.remote_id)
  const overLimit = value.items.length > MAX_IMPORT_ITEMS

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-account`}>{t('integrations.account')}</Label>
        <Select value={value.accountId} onValueChange={handleAccountChange}>
          <SelectTrigger id={`${idPrefix}-account`} className="w-full">
            <SelectValue placeholder={t('integrations.selectAccount')} />
          </SelectTrigger>
          <SelectContent>
            {accounts.map(a => (
              <SelectItem key={a.id} value={a.id}>
                <span className="inline-flex items-center gap-2">
                  <ProviderIcon provider={a.provider} />
                  {a.account_email ? `${a.name} (${a.account_email})` : a.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {account && (
        <div className="space-y-2">
          <Label>{t('integrations.pickerItems')}</Label>
          <p className="text-xs text-muted-foreground">{t('integrations.pickerHint')}</p>
          <div className="rounded-md border">
            {searching ? (
              <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  onClick={() => navigate(crumbs)}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {t('integrations.backToFolder')}
                </button>
                <span className="truncate text-muted-foreground">
                  {t('integrations.searchResultsFor', { query: debouncedQuery })}
                </span>
              </div>
            ) : (
            <nav
              aria-label={t('integrations.breadcrumb')}
              className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-sm"
            >
              {trail.map((crumb, index) => {
                const isLast = index === trail.length - 1
                return (
                  <span key={`${crumb.id ?? 'root'}-${index}`} className="inline-flex items-center gap-1">
                    {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    <button
                      type="button"
                      className={
                        isLast
                          ? 'font-medium inline-flex items-center gap-1'
                          : 'text-primary hover:underline inline-flex items-center gap-1'
                      }
                      onClick={() => navigate(crumbs.slice(0, index))}
                      disabled={isLast}
                    >
                      {index === 0 && <House className="h-3.5 w-3.5" />}
                      {crumb.name}
                    </button>
                  </span>
                )
              })}
            </nav>
            )}

            <div className="border-b px-3 py-2 space-y-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={
                    accountSearch
                      ? t('integrations.searchAccountPlaceholder')
                      : t('integrations.filterPlaceholder')
                  }
                  aria-label={t('integrations.filterPlaceholder')}
                  className="h-8 pl-8 pr-8"
                />
                {filter && (
                  <button
                    type="button"
                    onClick={() => setFilter('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={t('integrations.clearFilter')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {!accountSearch && filter.trim().length >= SEARCH_MIN_CHARS && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">
                    {t('integrations.filterCount', {
                      shown: visibleItems.length,
                      total: listing?.items.length ?? 0,
                    })}
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                    onClick={() => setAccountSearch(true)}
                  >
                    <Search className="h-3 w-3" />
                    {t('integrations.searchWholeAccount')}
                  </button>
                </div>
              )}
              {accountSearch && filter.trim().length < SEARCH_MIN_CHARS && (
                <p className="text-xs text-muted-foreground">{t('integrations.searchMinChars')}</p>
              )}
            </div>

            <div className="max-h-64 overflow-y-auto p-1">
              {(searching ? searchLoading && !searchResult : listingLoading) ? (
                <div className="flex justify-center py-6">
                  <LoadingSpinner />
                </div>
              ) : searching && searchError ? (
                <p className="p-3 text-sm text-destructive">
                  {getApiErrorMessage(searchErrorObj, t, 'integrations.searchFailed')}
                </p>
              ) : !searching && listingError ? (
                <p className="p-3 text-sm text-destructive">
                  {getApiErrorMessage(listingErrorObj, t, 'integrations.browseLoadFailed')}
                </p>
              ) : visibleItems.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  {searching || normalizedFilter ? t('integrations.noMatches') : t('integrations.emptyFolder')}
                </p>
              ) : (
                <ul>
                  {visibleItems.map(item => {
                    const disabled = !item.eligible
                    const selectable = item.selectable !== false
                    const checkboxId = `${idPrefix}-item-${item.id}`
                    return (
                      <li
                        key={item.id}
                        className={cn(
                          'flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
                          disabled && 'opacity-60'
                        )}
                      >
                        <Checkbox
                          id={checkboxId}
                          checked={selectedIds.has(item.id)}
                          disabled={disabled || !selectable}
                          onCheckedChange={() => toggleItem(toImportItem(item))}
                          aria-label={item.name}
                        />
                        <LinkKindIcon kind={item.kind} className="text-muted-foreground shrink-0" />
                        {item.kind === 'folder' ? (
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-1 text-left"
                            onClick={() =>
                              navigate(
                                searching
                                  // a search hit has no known crumb chain: open it on its own
                                  ? [{ id: item.id, name: displayName(item), path: item.path }]
                                  : [...crumbs, { id: item.id, name: displayName(item), path: item.path }]
                              )
                            }
                            title={selectable ? t('integrations.openFolder') : t('integrations.virtualFolderHint')}
                          >
                            <span className="truncate">{displayName(item)}</span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          </button>
                        ) : (
                          <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
                            <span className="block truncate" title={item.name}>
                              {item.name}
                            </span>
                            {searching && (
                              <span className="block truncate text-xs text-muted-foreground" title={item.path}>
                                {item.path}
                              </span>
                            )}
                            {disabled && (
                              <span className="block text-xs text-muted-foreground">
                                {t('integrations.fileNotEligible')}
                              </span>
                            )}
                          </label>
                        )}
                        {item.kind === 'file' && item.size !== null && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatFileSize(item.size)}
                          </span>
                        )}
                        {item.web_url && (
                          <a
                            href={item.web_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground shrink-0"
                            aria-label={t(openInProviderKey(account.provider))}
                            title={t(openInProviderKey(account.provider))}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {searching && searchResult?.truncated && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('integrations.searchTruncated')}</p>
              )}
            </div>

            {!searching && (
            <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
              <Button
                type="button"
                size="sm"
                variant={currentIsSelected ? 'secondary' : 'outline'}
                disabled={listing?.selectable === false}
                title={listing?.selectable === false ? t('integrations.virtualFolderHint') : undefined}
                onClick={() => currentFolderItem && toggleItem(currentFolderItem)}
              >
                {currentIsSelected && <Check className="h-4 w-4" />}
                {t('integrations.selectCurrentFolder')}
              </Button>
            </div>
            )}
          </div>

          <div className="space-y-2" data-testid="cloud-picker-selection">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">
                {t('integrations.selectedCount', { count: value.items.length })}
              </span>
              {value.items.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => onChange({ ...value, items: [] })}
                >
                  {t('integrations.clearSelection')}
                </button>
              )}
            </div>
            {value.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('integrations.nothingSelected')}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {value.items.map(item => (
                  <li key={item.remote_id}>
                    <Badge variant="secondary" className="gap-1 pr-1 font-normal">
                      <LinkKindIcon kind={item.kind} className="h-3 w-3" />
                      <span className="max-w-[16rem] truncate" title={item.remote_path}>
                        {item.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeItem(item.remote_id)}
                        className="rounded-sm hover:bg-muted p-0.5"
                        aria-label={t('integrations.removeFromSelection', { name: item.name })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {overLimit && (
              <p className="text-xs text-destructive">
                {t('integrations.tooManyItems', { max: MAX_IMPORT_ITEMS })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
