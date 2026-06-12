import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadCsv } from './csvExport.js'

describe('downloadCsv', () => {
  let mockAnchor

  beforeEach(() => {
    mockAnchor = { href: '', download: '', click: vi.fn() }

    vi.stubGlobal('document', {
      createElement: vi.fn(() => mockAnchor),
    })
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal(
      'Blob',
      class MockBlob {
        constructor(parts, opts) {
          this.text = parts[0]
          this.type = opts?.type
        }
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('triggers a download with the given filename', () => {
    downloadCsv('test.csv', [
      ['a', 'b'],
      ['1', '2'],
    ])
    expect(document.createElement).toHaveBeenCalledWith('a')
    expect(mockAnchor.download).toBe('test.csv')
    expect(mockAnchor.click).toHaveBeenCalled()
  })

  it('produces correct CSV for simple rows', () => {
    downloadCsv('out.csv', [
      ['Name', 'Runs'],
      ['Alice', '42'],
    ])
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(blob.text).toBe('Name,Runs\nAlice,42')
  })

  it('escapes values containing commas', () => {
    downloadCsv('out.csv', [['Smith, Joe', '10']])
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(blob.text).toBe('"Smith, Joe",10')
  })

  it('escapes values containing double quotes', () => {
    downloadCsv('out.csv', [['say "hi"', '5']])
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(blob.text).toBe('"say ""hi""",5')
  })

  it('handles null and undefined values as empty string', () => {
    downloadCsv('out.csv', [[null, undefined, 0]])
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(blob.text).toBe(',,0')
  })

  it('revokes the object URL after click', () => {
    downloadCsv('out.csv', [['a']])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })
})
