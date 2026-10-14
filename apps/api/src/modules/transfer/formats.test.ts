import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from './csv'
import { checklistCell, pageFiles, safeFileName } from './export.service'
import { readCsvTasks, readTrelloTasks } from './import.readers'
import { parseDueDate } from './import.service'
import { createZip } from './zip'
import { readZip } from '../../test/zip'

describe('parseCsv', () => {
  it('reads quoted fields with separators, doubled quotes and line breaks', () => {
    const text = 'Title,Description\r\n"Fix, then ship","Say ""hi""\non two lines"\r\nPlain,\r\n'
    expect(parseCsv(text)).toEqual([
      ['Title', 'Description'],
      ['Fix, then ship', 'Say "hi"\non two lines'],
      ['Plain', ''],
    ])
  })

  it('takes the separator the header uses and skips a byte-order mark and blank lines', () => {
    expect(parseCsv('﻿Название;Статус\n\nПочинить;Готово\n')).toEqual([
      ['Название', 'Статус'],
      ['Починить', 'Готово'],
    ])
    expect(parseCsv('Title\tStatus\nA\tB')).toEqual([
      ['Title', 'Status'],
      ['A', 'B'],
    ])
  })
})

describe('toCsv', () => {
  it('quotes what needs it and reads back the same', () => {
    const rows = [
      ['Key', 'Title'],
      ['T-1', 'Comma, "quote"; semicolon\nand a line'],
    ]
    const csv = toCsv(rows)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(parseCsv(csv)).toEqual(rows)
  })

  it('keeps spreadsheets from running a cell as a formula', () => {
    const csv = toCsv([['=HYPERLINK("http://evil")', '+1', '-2', '@SUM(A1)', 'safe']])
    expect(parseCsv(csv)[0]).toEqual([
      `'=HYPERLINK("http://evil")`,
      `'+1`,
      `'-2`,
      `'@SUM(A1)`,
      'safe',
    ])
  })
})

describe('createZip', () => {
  it('makes an archive that reads back, with UTF-8 names', () => {
    const modified = new Date('2026-03-04T05:06:08Z')
    const zip = createZip([
      { name: 'Главная.md', content: Buffer.from('# Главная\n'), modified },
      { name: 'Docs/Setup.md', content: Buffer.from('x'.repeat(5000)), modified },
    ])
    const files = readZip(zip)
    expect([...files.keys()]).toEqual(['Главная.md', 'Docs/Setup.md'])
    expect(files.get('Главная.md')).toBe('# Главная\n')
    expect(files.get('Docs/Setup.md')).toHaveLength(5000)
    // Compressed: the repeated text takes far less than its length.
    expect(zip.length).toBeLessThan(1000)
  })

  it('makes a valid empty archive', () => {
    expect(readZip(createZip([])).size).toBe(0)
  })
})

describe('safeFileName', () => {
  it('replaces what file systems refuse and hides nothing', () => {
    expect(safeFileName('a/b\\c: "d"?')).toBe('a-b-c- -d--')
    expect(safeFileName('report‮txt.md')).toBe('report-txt.md')
    expect(safeFileName('  Trailing dots...  ')).toBe('Trailing dots')
    expect(safeFileName('..hidden')).toBe('hidden')
    expect(safeFileName('CON')).toBe('page-CON')
    expect(safeFileName('///')).toBe('---')
    expect(safeFileName('')).toBe('page-')
    expect(safeFileName('x'.repeat(300))).toHaveLength(100)
  })
})

describe('pageFiles', () => {
  const page = (id: string, title: string, parentId: string | null = null) => ({
    id,
    parentId,
    title,
    content: `About ${title}`,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  })

  it('lays out the tree as files and folders', () => {
    const files = pageFiles([page('1', 'Home'), page('2', 'Setup', '1'), page('3', 'Linux', '2')])
    expect(files.map((file) => file.name)).toEqual([
      'Home.md',
      'Home/Setup.md',
      'Home/Setup/Linux.md',
    ])
    expect(files[0]?.content.toString()).toBe('# Home\n\nAbout Home\n')
  })

  it('numbers names that clash, ignoring case, and with the folders of other pages', () => {
    const files = pageFiles([
      page('1', 'a/b'),
      page('2', 'a-b'),
      page('3', 'A.md'),
      page('4', 'A'),
      page('5', 'Child', '3'),
    ])
    const names = files.map((file) => file.name)
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length)
    // Page A takes A.md, so page A.md cannot be a folder of that name.
    expect(names).toContain('A.md')
    expect(names).toContain('A.md (2).md')
    expect(names).toContain('A.md (2)/Child.md')
    expect(names.filter((name) => name.startsWith('a-b'))).toEqual(['a-b.md', 'a-b (2).md'])
  })

  it('handles a very deep tree without growing paths past what a ZIP holds', () => {
    const chain = Array.from({ length: 5000 }, (_, index) =>
      page(String(index), 'x'.repeat(100), index === 0 ? null : String(index - 1)),
    )
    const files = pageFiles(chain)
    expect(files).toHaveLength(5000)
    expect(Math.max(...files.map((file) => Buffer.byteLength(file.name)))).toBeLessThan(1300)
    expect(new Set(files.map((file) => file.name.toLowerCase())).size).toBe(5000)
  })

  it('puts pages with a missing parent or a loop of parents at the top', () => {
    const files = pageFiles([
      page('1', 'Orphan', 'gone'),
      page('2', 'Ping', '3'),
      page('3', 'Pong', '2'),
    ])
    expect(files.map((file) => file.name).sort()).toEqual(['Orphan.md', 'Ping.md', 'Ping/Pong.md'])
  })
})

describe('parseDueDate', () => {
  it.each([
    ['2026-05-01', '2026-05-01'],
    ['2026-05-01T10:00:00Z', '2026-05-01'],
    ['2026-05-01 10:00', '2026-05-01'],
    ['1.5.2026', '2026-05-01'],
    ['01.05.2026', '2026-05-01'],
    ['01/May/26 10:00 AM', '2026-05-01'],
    ['7/dec/2026', '2026-12-07'],
  ])('reads %s', (value, expected) => {
    expect(parseDueDate(value)).toBe(expected)
  })

  it.each(['tomorrow', '2026-13-01', '31.02.2026', '01/Foo/26', '0999-01-01'])(
    'refuses %s',
    (value) => {
      expect(parseDueDate(value)).toBeNull()
    },
  )
})

describe('readCsvTasks', () => {
  it('reads our own export back, checklist included', () => {
    const csv = toCsv([
      ['Key', 'Title', 'Status', 'Labels', 'Checklist', 'Description'],
      [
        'T-1',
        'Ship it',
        'Done',
        'bug, ui',
        checklistCell([
          { text: 'Write', done: true },
          { text: 'Test', done: false },
        ]),
        'All of it',
      ],
    ])
    const { drafts, skipped } = readCsvTasks(csv)
    expect(skipped).toEqual([])
    expect(drafts).toEqual([
      expect.objectContaining({
        row: 2,
        title: 'Ship it',
        status: 'Done',
        description: 'All of it',
        labels: [{ name: 'bug' }, { name: 'ui' }],
        checklist: [
          { text: 'Write', done: true },
          { text: 'Test', done: false },
        ],
      }),
    ])
  })

  it('reads a Jira export with repeated label columns and skips rows without a title', () => {
    const csv = [
      'Summary,Issue key,Status,Priority,Assignee,Due date,Labels,Labels,Fix Version/s',
      'Login fails,WEB-1,In Progress,Highest,ann@example.com,12/Mar/26 10:00 AM,auth,backend,1.0',
      ',WEB-2,Open,Low,,,,,',
    ].join('\n')
    const { drafts, skipped } = readCsvTasks(csv)
    expect(drafts).toEqual([
      expect.objectContaining({
        title: 'Login fails',
        status: 'In Progress',
        priority: 'Highest',
        assignee: 'ann@example.com',
        dueDate: '12/Mar/26 10:00 AM',
        milestone: '1.0',
        labels: [{ name: 'auth' }, { name: 'backend' }],
      }),
    ])
    expect(skipped).toEqual([{ row: 3, reason: 'No title' }])
  })

  it('reads a huge checklist line quickly, whatever it holds', () => {
    const cell = '[x]' + ' '.repeat(200_000) + 'a\rb'
    const started = performance.now()
    const { drafts } = readCsvTasks(
      toCsv([
        ['Title', 'Checklist'],
        ['T', cell],
      ]),
    )
    expect(performance.now() - started).toBeLessThan(500)
    // The first line is cut before its text begins; the second still counts.
    expect(drafts[0]?.checklist).toEqual([{ text: 'b', done: false }])
  })

  it('refuses a file without a title column or with too many rows', () => {
    expect(() => readCsvTasks('Name;Status')).not.toThrow()
    expect(() => readCsvTasks('Key,Status\nT-1,Done')).toThrow(/Title/)
    expect(() => readCsvTasks('')).toThrow(/empty/)
    const big = ['Title', ...Array.from({ length: 1001 }, (_, i) => `Task ${i}`)].join('\n')
    expect(() => readCsvTasks(big)).toThrow(/at most 1000/)
  })
})

describe('readTrelloTasks', () => {
  const board = {
    lists: [
      { id: 'l1', name: 'Backlog' },
      { id: 'l2', name: 'Old', closed: true },
    ],
    labels: [
      { id: 'g', name: 'Bug', color: 'red_dark' },
      { id: 's', name: '', color: 'sky' },
    ],
    members: [{ id: 'm1', fullName: 'Ann Lee', username: 'ann' }],
    checklists: [
      {
        idCard: 'c1',
        checkItems: [
          { name: 'Second', state: 'incomplete', pos: 2 },
          { name: 'First', state: 'complete', pos: 1 },
        ],
      },
    ],
    cards: [
      {
        id: 'c1',
        name: 'Card one',
        desc: 'Text',
        idList: 'l1',
        due: '2026-06-01T09:00:00.000Z',
        idLabels: ['g', 's'],
        idMembers: ['m1'],
      },
      { id: 'c2', name: 'Archived', idList: 'l1', closed: true },
      { id: 'c3', name: 'In a closed list', idList: 'l2' },
    ],
  }

  it('reads cards with their list, labels, member, due date and checklist', () => {
    const { drafts, skipped } = readTrelloTasks(JSON.stringify(board))
    expect(drafts).toEqual([
      {
        row: 1,
        title: 'Card one',
        description: 'Text',
        status: 'Backlog',
        priority: null,
        assignee: 'Ann Lee',
        dueDate: '2026-06-01',
        milestone: null,
        labels: [
          { name: 'Bug', color: 'red' },
          { name: 'sky', color: 'teal' },
        ],
        checklist: [
          { text: 'First', done: true },
          { text: 'Second', done: false },
        ],
      },
    ])
    expect(skipped.map((item) => item.row)).toEqual([2, 3])
  })

  it('refuses what is not a Trello board', () => {
    expect(() => readTrelloTasks('not json')).toThrow(/not JSON/)
    expect(() => readTrelloTasks('{"cards": 1}')).toThrow(/Trello/)
  })
})
