import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { IntegrationSettings } from '@/lib/api/integrations'
import { parseExtensions } from './integration-utils'

// Radix Select measures its trigger via ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

vi.mock('@/lib/hooks/use-integrations', () => ({
  useUpdateIntegrationSettings: () => ({ isPending: false, mutate: vi.fn() }),
}))

import { buildSettingsPayload, SyncSettingsForm } from './SyncSettingsForm'

function makeSettings(overrides: Partial<IntegrationSettings> = {}): IntegrationSettings {
  return {
    public_url: 'https://nb.example.com',
    public_url_source: 'db',
    scheduler_enabled: true,
    scheduler_forced_off: false,
    default_interval_minutes: 30,
    max_file_mb: 50,
    allowed_extensions: ['pdf', 'docx'],
    google_export_formats: { document: 'docx', spreadsheet: 'xlsx', presentation: 'pptx' },
    ...overrides,
  }
}

const formData = {
  public_url: 'https://notebook.example.com/',
  scheduler_enabled: false,
  default_interval_minutes: '15',
  max_file_mb: '100',
  allowed_extensions: '.PDF, docx,, .Md  txt, pdf',
  document: 'md' as const,
  spreadsheet: 'csv' as const,
  presentation: 'pdf' as const,
}

describe('parseExtensions', () => {
  it('lowercases, strips dots, drops empties and de-duplicates', () => {
    expect(parseExtensions('.PDF, docx,, .Md  txt, pdf')).toEqual(['pdf', 'docx', 'md', 'txt'])
    expect(parseExtensions('')).toEqual([])
  })
})

describe('buildSettingsPayload', () => {
  it('converts form values to the API shape', () => {
    expect(buildSettingsPayload(formData, makeSettings())).toEqual({
      public_url: 'https://notebook.example.com',
      scheduler_enabled: false,
      default_interval_minutes: 15,
      max_file_mb: 100,
      allowed_extensions: ['pdf', 'docx', 'md', 'txt'],
      google_export_formats: { document: 'md', spreadsheet: 'csv', presentation: 'pdf' },
    })
  })

  it('omits env-managed public URL and a forced-off scheduler', () => {
    const payload = buildSettingsPayload(
      formData,
      makeSettings({ public_url_source: 'env', scheduler_forced_off: true })
    )
    expect(payload).not.toHaveProperty('public_url')
    expect(payload).not.toHaveProperty('scheduler_enabled')
  })

  it('sends null to clear the public URL', () => {
    const payload = buildSettingsPayload({ ...formData, public_url: '  ' }, makeSettings())
    expect(payload.public_url).toBeNull()
  })
})

describe('SyncSettingsForm', () => {
  it('shows the extensions as a comma-separated list', () => {
    render(<SyncSettingsForm settings={makeSettings()} />)
    expect(screen.getByLabelText('integrations.allowedExtensions')).toHaveValue('pdf, docx')
  })

  it('locks env-managed public URL and a forced-off scheduler', () => {
    render(
      <SyncSettingsForm
        settings={makeSettings({ public_url_source: 'env', scheduler_forced_off: true })}
      />
    )
    expect(screen.getByLabelText('integrations.publicUrl')).toBeDisabled()
    expect(screen.getByText('integrations.managedByEnv')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'integrations.schedulerEnabled' })).toBeDisabled()
    expect(screen.getByText('integrations.schedulerForcedOff')).toBeInTheDocument()
  })
})
