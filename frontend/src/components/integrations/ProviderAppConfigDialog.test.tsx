import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationProvider } from '@/lib/api/integrations'
import { ProviderAppConfigDialog } from './ProviderAppConfigDialog'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const mutate = vi.fn()
vi.mock('@/lib/hooks/use-integrations', () => ({
  useUpdateProviderAppConfig: () => ({ isPending: false, mutate }),
}))

function makeProvider(overrides: Partial<IntegrationProvider> = {}): IntegrationProvider {
  return {
    provider: 'dropbox',
    display_name: 'Dropbox',
    configured: true,
    config_source: 'db',
    client_id: 'abc123',
    has_secret: true,
    redirect_uri: 'https://nb.example.com/api/integrations/providers/dropbox/callback',
    console_url: 'https://www.dropbox.com/developers/apps',
    ...overrides,
  }
}

function renderDialog(provider: IntegrationProvider) {
  return render(<ProviderAppConfigDialog open onOpenChange={vi.fn()} provider={provider} />)
}

describe('ProviderAppConfigDialog', () => {
  beforeEach(() => mutate.mockReset())

  it('is read-only when the config is managed by environment variables', () => {
    renderDialog(makeProvider({ config_source: 'env' }))

    expect(screen.getByText('integrations.managedByEnv')).toBeInTheDocument()
    expect(screen.getByLabelText('integrations.clientId')).toBeDisabled()
    expect(screen.queryByLabelText('integrations.clientSecret')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.save' })).not.toBeInTheDocument()
  })

  it('keeps the stored secret when the secret field is left blank', () => {
    renderDialog(makeProvider())

    const secret = screen.getByLabelText('integrations.clientSecret')
    expect(secret).toHaveAttribute('placeholder', 'integrations.clientSecretKeepPlaceholder')

    fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
    expect(mutate).toHaveBeenCalledWith(
      { provider: 'dropbox', data: { client_id: 'abc123', client_secret: null } },
      expect.anything()
    )
  })

  it('requires a secret when none is stored yet', () => {
    renderDialog(makeProvider({ has_secret: false, configured: false }))
    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('integrations.clientSecret'), {
      target: { value: 's3cret' },
    })
    expect(screen.getByRole('button', { name: 'common.save' })).toBeEnabled()
  })

  it('warns to set the public URL when there is no redirect URI', () => {
    renderDialog(makeProvider({ redirect_uri: null }))
    expect(screen.getByText('integrations.redirectUriMissing')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'integrations.copyRedirectUri' })
    ).not.toBeInTheDocument()
  })
})
