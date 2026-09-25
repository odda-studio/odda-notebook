import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationProvider } from '@/lib/api/integrations'
import { ProviderCard } from './ProviderCard'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const authorizeMutate = vi.fn()
vi.mock('@/lib/hooks/use-integrations', () => ({
  useAuthorizeProvider: () => ({ isPending: false, mutate: authorizeMutate }),
  useDeleteProviderAppConfig: () => ({ isPending: false, mutate: vi.fn() }),
  useDisconnectAccount: () => ({ isPending: false, mutate: vi.fn() }),
}))

vi.mock('./ProviderAppConfigDialog', () => ({
  ProviderAppConfigDialog: () => <div data-testid="app-config-dialog" />,
}))

function makeProvider(overrides: Partial<IntegrationProvider> = {}): IntegrationProvider {
  return {
    provider: 'google_drive',
    display_name: 'Google Drive',
    configured: true,
    config_source: 'db',
    client_id: 'client.apps.googleusercontent.com',
    has_secret: true,
    redirect_uri: 'https://nb.example.com/api/integrations/providers/google_drive/callback',
    console_url: 'https://console.cloud.google.com/apis/credentials',
    ...overrides,
  }
}

const connectButton = () => screen.getByRole('button', { name: 'integrations.connectAccount' })

describe('ProviderCard', () => {
  beforeEach(() => authorizeMutate.mockReset())

  it('disables Connect account until the app is configured', () => {
    render(
      <ProviderCard
        provider={makeProvider({ configured: false, client_id: null, has_secret: false, config_source: null })}
        accounts={[]}
      />
    )
    expect(connectButton()).toBeDisabled()
    expect(screen.getByText('integrations.connectNeedsApp')).toBeInTheDocument()
  })

  it('disables Connect account when there is no redirect URI (public URL unset)', () => {
    render(<ProviderCard provider={makeProvider({ redirect_uri: null })} accounts={[]} />)
    expect(connectButton()).toBeDisabled()
    expect(screen.getByText('integrations.connectNeedsPublicUrl')).toBeInTheDocument()
  })

  it('starts the OAuth flow when configured', () => {
    render(<ProviderCard provider={makeProvider()} accounts={[]} />)
    expect(connectButton()).toBeEnabled()
    fireEvent.click(connectButton())
    expect(authorizeMutate).toHaveBeenCalledWith('google_drive', expect.anything())
  })

  it('shows the Google testing-mode note and hides delete for env-managed apps', () => {
    render(<ProviderCard provider={makeProvider({ config_source: 'env' })} accounts={[]} />)
    expect(screen.getByText('integrations.googleTestingModeNote')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'integrations.deleteAppConfig' })
    ).not.toBeInTheDocument()
  })

  it('lists connected accounts with a disconnect action', () => {
    render(
      <ProviderCard
        provider={makeProvider()}
        accounts={[
          {
            id: 'integration_account:1',
            provider: 'google_drive',
            name: 'Ada Lovelace',
            account_email: 'ada@example.com',
            sync_folder_count: 2,
            created: '2026-01-01T00:00:00Z',
            updated: '2026-01-01T00:00:00Z',
          },
        ]}
      />
    )
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'integrations.disconnect' })).toBeInTheDocument()
  })
})
