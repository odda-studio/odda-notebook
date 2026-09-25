'use client'

import { useState } from 'react'
import { AlertCircle, Info, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useSyncLinks } from '@/lib/hooks/use-integrations'
import type { IntegrationAccount } from '@/lib/api/integrations'
import { CloudImportDialog } from './CloudImportDialog'
import { LinkItem } from './LinkItem'

interface LinkListProps {
  accounts: IntegrationAccount[]
}

export function LinkList({ accounts }: LinkListProps) {
  const { t } = useTranslation()
  const { data: links, isLoading, isError } = useSyncLinks()
  const [importOpen, setImportOpen] = useState(false)

  const hasAccounts = accounts.length > 0

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>{t('integrations.linksTitle')}</CardTitle>
            <CardDescription>{t('integrations.linksDescription')}</CardDescription>
          </div>
          <Button size="sm" onClick={() => setImportOpen(true)} disabled={!hasAccounts}>
            <Plus className="h-4 w-4" />
            {t('integrations.addLink')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {t('integrations.syncSemantics')}
        </p>

        {!hasAccounts && (
          <p className="text-sm text-muted-foreground">{t('integrations.addLinkNeedsAccount')}</p>
        )}

        {isLoading ? (
          <div className="flex justify-center py-6">
            <LoadingSpinner />
          </div>
        ) : isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{t('integrations.linksLoadFailed')}</AlertTitle>
            <AlertDescription>{t('integrations.tryAgainLater')}</AlertDescription>
          </Alert>
        ) : !links || links.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('integrations.noLinks')}</p>
        ) : (
          <ul className="space-y-3">
            {links.map(link => (
              <LinkItem key={link.id} link={link} />
            ))}
          </ul>
        )}
      </CardContent>

      {importOpen && <CloudImportDialog open={importOpen} onOpenChange={setImportOpen} />}
    </Card>
  )
}
