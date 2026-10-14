// Fills an EMPTY, throwaway ChillaDesk with a believable demo project and takes the
// screenshots in docs/screenshots. It signs up demo accounts, so never point it at a real
// installation.
//
//   node apps/e2e/scripts/screenshots.mjs [base url] [out dir]
//
// PW_CHANNEL=msedge (or chrome) uses an installed browser instead of Playwright's own.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const [base = 'http://localhost:8090', out = 'docs/screenshots'] = process.argv.slice(2)
mkdirSync(out, { recursive: true })

async function api(method, path, body, token) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (response.status >= 300) throw new Error(`${method} ${path}: ${response.status} ${text}`)
  return data
}

const PASSWORD = 'demo password for screenshots'
async function person(name, email, locale = 'en') {
  const { token, user } = await api('POST', '/auth/register', {
    name,
    email,
    password: PASSWORD,
    locale,
  })
  return { token, user, email }
}

// --- people and a project ---
const anna = await person('Anna Petrova', 'anna@example.com')
const ben = await person('Ben Carter', 'ben@example.com')
const chloe = await person('Chloe Martin', 'chloe@example.com')
const t = anna.token
const project = await api(
  'POST',
  '/projects',
  { name: 'Website relaunch', key: 'WEB', description: 'New marketing site and customer portal' },
  t,
)
const p = `/projects/${project.id}`
await api('POST', `${p}/members`, { email: ben.email, role: 'member' }, t)
await api('POST', `${p}/members`, { email: chloe.email, role: 'member' }, t)
const [todo, doing, done] = await api('GET', `${p}/statuses`, null, t)
const review = await api('POST', `${p}/statuses`, { name: 'Review', category: 'in_progress' }, t)
await api(
  'PUT',
  `${p}/statuses/order`,
  {
    statusIds: [todo.id, doing.id, review.id, done.id],
  },
  t,
)

const label = {}
for (const [name, color] of [
  ['frontend', 'blue'],
  ['backend', 'green'],
  ['bug', 'red'],
  ['design', 'purple'],
  ['content', 'orange'],
]) {
  label[name] = (await api('POST', `${p}/labels`, { name, color }, t)).id
}
const beta = await api('POST', `${p}/milestones`, { name: 'Public beta', dueDate: '2026-11-02' }, t)
const launch = await api('POST', `${p}/milestones`, { name: 'Launch', dueDate: '2026-12-01' }, t)

const tasks = [
  [
    'Design the new home page',
    doing,
    'high',
    chloe,
    '2026-10-20',
    beta,
    ['design', 'frontend'],
    ['Hero section', 'Pricing block', 'Footer'],
    2,
  ],
  ['Set up the CDN for static assets', done, 'medium', ben, null, beta, ['backend'], [], 0],
  [
    'Fix the login redirect on Safari',
    review,
    'urgent',
    ben,
    '2026-10-16',
    beta,
    ['bug', 'frontend'],
    [],
    0,
  ],
  [
    'Write copy for the features page',
    todo,
    'medium',
    anna,
    '2026-10-24',
    beta,
    ['content'],
    ['Draft', 'Review with marketing'],
    1,
  ],
  [
    'Customer portal: invoices list',
    doing,
    'high',
    ben,
    '2026-10-28',
    launch,
    ['backend', 'frontend'],
    ['API endpoint', 'Table', 'PDF download'],
    1,
  ],
  [
    'Cookie banner that respects "no"',
    todo,
    'high',
    chloe,
    '2026-10-30',
    beta,
    ['frontend'],
    [],
    0,
  ],
  [
    'Migrate blog posts from the old CMS',
    todo,
    'low',
    null,
    null,
    launch,
    ['content', 'backend'],
    [],
    0,
  ],
  ['Accessibility audit', todo, 'medium', anna, '2026-11-10', launch, ['design'], [], 0],
  ['Image compression in the build', done, 'low', chloe, null, beta, ['frontend'], [], 0],
  ['Search for the help center', todo, 'medium', ben, '2026-11-20', launch, ['backend'], [], 0],
  ['Broken links report', review, 'low', anna, null, null, ['bug', 'content'], [], 0],
]
const created = {}
for (const [
  title,
  status,
  priority,
  who,
  dueDate,
  milestone,
  labels,
  checklist,
  doneItems,
] of tasks) {
  const task = await api(
    'POST',
    `${p}/tasks`,
    {
      title,
      statusId: status.id,
      priority,
      assigneeId: who?.user.id ?? null,
      dueDate,
      milestoneId: milestone?.id ?? null,
      labelIds: labels.map((name) => label[name]),
      description:
        title === 'Design the new home page'
          ? 'The home page should say what we do in one sentence and show the product at work.\n\n' +
            '- Keep the **hero** short\n- One call to action\n- Screenshots instead of illustrations\n\n' +
            'See [[Brand guidelines]] for colours and type. Depends on WEB-4 for the copy.'
          : '',
    },
    t,
  )
  created[title] = task
  for (const [index, text] of checklist.entries()) {
    const item = await api('POST', `${p}/tasks/${task.id}/checklist`, { text }, t)
    if (index < doneItems)
      await api('PATCH', `${p}/tasks/${task.id}/checklist/${item.id}`, { done: true }, t)
  }
}
const home = created['Design the new home page']
await api(
  'POST',
  `${p}/tasks/${home.id}/comments`,
  {
    body: 'First draft is in Figma. @ben@example.com can you check how the hero behaves on mobile?',
  },
  chloe.token,
)
await api(
  'POST',
  `${p}/tasks/${home.id}/comments`,
  {
    body: 'Looks good on iOS. On small Android screens the button wraps; I left a note in the file.',
  },
  ben.token,
)
await api(
  'POST',
  `${p}/tasks/${home.id}/links`,
  {
    relation: 'blocks',
    taskNumber: created['Write copy for the features page'].number,
  },
  t,
).catch(() => undefined)

// --- wiki ---
const guide = await api(
  'POST',
  `${p}/wiki`,
  {
    title: 'Onboarding',
    content:
      'Welcome to the **website relaunch**! This page gets you started in a day.\n\n' +
      '## First steps\n\n1. Read the [[Brand guidelines]]\n2. Set up the project: see [[Local setup]]\n' +
      '3. Pick a task from the board, for example WEB-6\n\n## Who to ask\n\n' +
      '| Topic | Person |\n| --- | --- |\n| Design | Chloe |\n| Backend and hosting | Ben |\n| Content | Anna |\n\n' +
      '> Releases go out every Thursday. Anything merged by Wednesday evening is in.\n\n' +
      '```bash\npnpm install\npnpm dev\n```',
  },
  t,
)
await api(
  'POST',
  `${p}/wiki`,
  {
    title: 'Brand guidelines',
    parentId: guide.id,
    content:
      'Colours, type and tone of voice.\n\n- Primary: indigo\n- Type: Inter\n- Tone: plain and friendly',
  },
  chloe.token,
)
await api(
  'POST',
  `${p}/wiki`,
  {
    title: 'Local setup',
    parentId: guide.id,
    content: 'You need Node.js 22 and Docker.',
  },
  ben.token,
)
await api(
  'POST',
  `${p}/wiki`,
  {
    title: 'Release process',
    content: 'How a release goes out, step by step.',
  },
  ben.token,
)

// A project in Russian, made by someone whose interface is Russian (so are its columns).
const ivan = await person('Иван Смирнов', 'ivan@example.com', 'ru')
const app = await api(
  'POST',
  '/projects',
  { name: 'Мобильное приложение', key: 'APP', description: 'Приложения для iOS и Android' },
  ivan.token,
)
const ap = `/projects/${app.id}`
await api('POST', `${ap}/members`, { email: anna.email, role: 'member' }, ivan.token)
const [rTodo, rDoing, rDone] = await api('GET', `${ap}/statuses`, null, ivan.token)
const rLabel = {}
for (const [name, color] of [
  ['ios', 'blue'],
  ['android', 'green'],
  ['ошибка', 'red'],
  ['дизайн', 'purple'],
]) {
  rLabel[name] = (await api('POST', `${ap}/labels`, { name, color }, ivan.token)).id
}
for (const [title, status, priority, who, dueDate, labels] of [
  ['Экран входа по коду из СМС', rDoing, 'high', ivan, '2026-10-21', ['ios', 'android']],
  ['Тёмная тема', rTodo, 'medium', anna, '2026-11-05', ['дизайн']],
  [
    'Падение при повороте экрана на планшете',
    rDoing,
    'urgent',
    ivan,
    '2026-10-17',
    ['ошибка', 'android'],
  ],
  ['Push-уведомления о новых заказах', rTodo, 'high', null, '2026-11-12', ['ios', 'android']],
  ['Иконки для App Store и Google Play', rDone, 'low', anna, null, ['дизайн']],
  ['Офлайн-режим для каталога', rTodo, 'low', ivan, null, ['android']],
]) {
  await api(
    'POST',
    `${ap}/tasks`,
    {
      title,
      statusId: status.id,
      priority,
      assigneeId: who?.user.id ?? null,
      dueDate,
      labelIds: labels.map((name) => rLabel[name]),
    },
    ivan.token,
  )
}
await api(
  'POST',
  '/projects',
  { name: 'Support', key: 'SUP', description: 'Questions from customers' },
  t,
)

// --- screenshots ---
// The browser's own language decides how date fields look, so each language gets its own.
const browsers = {
  en: await chromium.launch({
    channel: process.env.PW_CHANNEL || undefined,
    args: ['--lang=en-US'],
  }),
  ru: await chromium.launch({
    channel: process.env.PW_CHANNEL || undefined,
    args: ['--lang=ru-RU'],
  }),
}
async function shoot(
  name,
  path,
  { colorScheme = 'light', locale = 'en', who = anna, prepare } = {},
) {
  const context = await browsers[locale].newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme,
    locale: locale === 'ru' ? 'ru-RU' : 'en-US',
  })
  await context.request.post(`${base}/api/auth/login`, {
    data: { email: who.email, password: PASSWORD },
  })
  const page = await context.newPage()
  // The interface language is kept in the browser; set it before the app starts.
  await page.addInitScript((lang) => localStorage.setItem('cw_locale', lang), locale)
  await page.goto(`${base}${path}`)
  await page.waitForLoadState('networkidle')
  if (prepare) await prepare(page)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${name}.png`) })
  await context.close()
  console.log('saved', name)
}

await shoot('board', `/projects/${project.id}`)
await shoot('task', `/projects/${project.id}/tasks/${home.number}`, {
  prepare: (page) => page.getByRole('dialog').waitFor(),
})
await shoot('list', `/projects/${project.id}/list`)
await shoot('wiki', `/projects/${project.id}/wiki/${guide.id}`)
await shoot('milestones', `/projects/${project.id}/milestones`)
await shoot('board-dark', `/projects/${project.id}`, { colorScheme: 'dark' })
await shoot('board-ru', `/projects/${app.id}`, { locale: 'ru', who: ivan })
await shoot('projects', '/')
await browsers.en.close()
await browsers.ru.close()
