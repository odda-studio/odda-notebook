/**
 * Helpers for the website widget admin UI: origin validation/normalization
 * and embed snippet generation.
 */

const ORIGIN_RE = /^https?:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/

/**
 * Normalize a single origin: trim, lowercase, drop trailing slashes.
 * Returns null when it is not a valid `scheme://host[:port]` (paths, queries, etc. are rejected).
 */
export function normalizeOrigin(raw: string): string | null {
  const value = raw.trim().toLowerCase().replace(/\/+$/, '')
  if (!ORIGIN_RE.test(value)) return null
  const port = value.match(/:(\d{1,5})$/)
  if (port && Number(port[1]) > 65535) return null
  return value
}

/**
 * Parse a textarea (one origin per line). Blank lines are ignored, duplicates removed.
 */
export function parseOrigins(text: string): { origins: string[]; invalid: string[] } {
  const origins: string[] = []
  const invalid: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const origin = normalizeOrigin(line)
    if (origin === null) {
      invalid.push(line.trim())
    } else if (!origins.includes(origin)) {
      origins.push(origin)
    }
  }
  return { origins, invalid }
}

/** Browser-visible API base, without trailing slash or trailing `/api`. */
export function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '').replace(/\/api$/, '')
}

export const PLACEHOLDER_WIDGET_KEY = 'YOUR_WIDGET_KEY'

export type EmbedVariant = 'floating' | 'inline'

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export function buildEmbedSnippet(opts: {
  apiUrl: string
  notebookId: string
  widgetKey: string
  title: string
  variant: EmbedVariant
}): string {
  const apiUrl = normalizeApiUrl(opts.apiUrl)
  const tag = opts.variant === 'floating' ? 'odda-notebook-chatbot' : 'odda-notebook-chat'
  const attrs = [
    `api-url="${escapeAttr(apiUrl)}"`,
    `notebook-id="${escapeAttr(opts.notebookId)}"`,
    `widget-key="${escapeAttr(opts.widgetKey)}"`,
    `title="${escapeAttr(opts.title)}"`,
    `search-mode="insights-first"`,
  ]
  if (opts.variant === 'inline') attrs.push('height="560px"')
  return (
    `<script src="${escapeAttr(apiUrl)}/api/widget/embed.js" async></script>\n` +
    `<${tag}\n` +
    attrs.map((a) => `  ${a}`).join('\n') +
    `></${tag}>`
  )
}
