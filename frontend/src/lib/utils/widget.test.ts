import { describe, expect, it } from 'vitest'
import { buildEmbedSnippet, normalizeApiUrl, normalizeOrigin, parseOrigins } from './widget'

describe('normalizeOrigin', () => {
  it('lowercases, trims and strips trailing slashes', () => {
    expect(normalizeOrigin('  HTTPS://WWW.Example.com/ ')).toBe('https://www.example.com')
    expect(normalizeOrigin('http://localhost:3000//')).toBe('http://localhost:3000')
  })

  it.each([
    'example.com',
    'ftp://example.com',
    'https://example.com/path',
    'https://example.com?x=1',
    'https://',
    'https://exa mple.com',
    'https://example.com:99999',
    '*',
  ])('rejects %s', (value) => {
    expect(normalizeOrigin(value)).toBeNull()
  })
})

describe('parseOrigins', () => {
  it('splits lines, ignores blanks, dedupes and reports invalid lines', () => {
    const result = parseOrigins('https://a.com/\n\nHTTPS://a.com\nnot-an-origin\nhttp://b.org:8080')
    expect(result.origins).toEqual(['https://a.com', 'http://b.org:8080'])
    expect(result.invalid).toEqual(['not-an-origin'])
  })

  it('returns empty lists for empty input', () => {
    expect(parseOrigins('  \n ')).toEqual({ origins: [], invalid: [] })
  })
})

describe('embed snippet', () => {
  it('strips trailing slash and /api from the API URL', () => {
    expect(normalizeApiUrl('https://api.example.com/api/')).toBe('https://api.example.com')
  })

  it('builds the floating snippet with real values', () => {
    const s = buildEmbedSnippet({
      apiUrl: 'https://api.example.com/api',
      notebookId: 'notebook:1',
      widgetKey: 'onw_abc',
      title: 'My "Book"',
      variant: 'floating',
    })
    expect(s).toContain('<script src="https://api.example.com/api/widget/embed.js" async></script>')
    expect(s).toContain('<odda-notebook-chatbot')
    expect(s).toContain('notebook-id="notebook:1"')
    expect(s).toContain('widget-key="onw_abc"')
    expect(s).toContain('title="My &quot;Book&quot;"')
    expect(s).toContain('search-mode="insights-first"></odda-notebook-chatbot>')
  })

  it('builds the inline snippet with a height', () => {
    const s = buildEmbedSnippet({
      apiUrl: 'https://x.io',
      notebookId: 'notebook:1',
      widgetKey: 'k',
      title: 'T',
      variant: 'inline',
    })
    expect(s).toContain('<odda-notebook-chat\n')
    expect(s).toContain('height="560px"')
  })
})
