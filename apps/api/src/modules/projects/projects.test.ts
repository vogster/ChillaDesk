import { projectMemberSchema, projectSchema, type Project } from '@chillawiki/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, type TestContext, type TestUser } from '../../test/harness'

let ctx: TestContext
let keyCounter = 0

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

// Keys are globally unique, so every project in this file gets its own.
const nextKey = () => `P${(keyCounter += 1)}`

function call(user: TestUser, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string) {
  return (payload?: Record<string, unknown>) =>
    ctx.app.inject({
      method,
      url: `/api/projects${url}`,
      headers: user.headers,
      ...(payload ? { payload } : {}),
    })
}

async function createProject(owner: TestUser, name = 'Demo'): Promise<Project> {
  const response = await call(owner, 'POST', '')({ name, key: nextKey() })
  expect(response.statusCode).toBe(201)
  return response.json<Project>()
}

async function addMember(owner: TestUser, project: Project, user: TestUser, role: string) {
  const response = await call(
    owner,
    'POST',
    `/${project.id}/members`,
  )({
    email: user.email,
    role,
  })
  expect(response.statusCode).toBe(201)
}

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

describe('authentication', () => {
  it.each([
    ['GET', ''],
    ['POST', ''],
    ['GET', `/${UNKNOWN_ID}`],
    ['GET', `/${UNKNOWN_ID}/members`],
  ] as const)('%s /api/projects%s requires a session', async (method, url) => {
    const response = await ctx.app.inject({ method, url: `/api/projects${url}` })

    expect(response.statusCode).toBe(401)
  })
})

describe('creating and listing projects', () => {
  it('makes the creator the owner', async () => {
    const owner = await ctx.signUp()

    const response = await call(
      owner,
      'POST',
      '',
    )({
      name: '  Chilla  ',
      key: nextKey(),
      description: 'Tracker',
    })

    expect(response.statusCode).toBe(201)
    expect(projectSchema.parse(response.json())).toMatchObject({
      name: 'Chilla',
      description: 'Tracker',
      role: 'owner',
    })
  })

  it('lists only the projects the user belongs to, sorted by name', async () => {
    const ann = await ctx.signUp()
    const bob = await ctx.signUp()
    await createProject(ann, 'Zebra')
    await createProject(ann, 'Alpha')
    await createProject(bob, 'Hidden')

    const response = await call(ann, 'GET', '')()

    expect(response.statusCode).toBe(200)
    expect(response.json<Project[]>().map((project) => project.name)).toEqual(['Alpha', 'Zebra'])
  })

  it('rejects a key that is already taken', async () => {
    const owner = await ctx.signUp()
    const existing = await createProject(owner)

    const response = await call(owner, 'POST', '')({ name: 'Copy', key: existing.key })

    expect(response.statusCode).toBe(409)
    expect(response.json<{ error: { message: string } }>().error.message).toContain(existing.key)
  })

  it('rejects an invalid key', async () => {
    const owner = await ctx.signUp()

    const response = await call(owner, 'POST', '')({ name: 'Bad', key: 'lower' })

    expect(response.statusCode).toBe(400)
  })
})

describe('reading a project', () => {
  it('returns the project with the caller role', async () => {
    const owner = await ctx.signUp()
    const viewer = await ctx.signUp()
    const project = await createProject(owner)
    await addMember(owner, project, viewer, 'viewer')

    const response = await call(viewer, 'GET', `/${project.id}`)()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: project.id, role: 'viewer' })
  })

  it('hides the project from non-members', async () => {
    const owner = await ctx.signUp()
    const stranger = await ctx.signUp()
    const project = await createProject(owner)

    const response = await call(stranger, 'GET', `/${project.id}`)()

    expect(response.statusCode).toBe(404)
  })

  it('rejects a malformed id', async () => {
    const owner = await ctx.signUp()

    const response = await call(owner, 'GET', '/not-a-uuid')()

    expect(response.statusCode).toBe(400)
  })
})

describe('updating and deleting a project', () => {
  it('lets the owner rename it', async () => {
    const owner = await ctx.signUp()
    const project = await createProject(owner)

    const response = await call(owner, 'PATCH', `/${project.id}`)({ name: 'Renamed' })

    expect(response.statusCode).toBe(200)
    const updated = response.json<Project>()
    expect(updated).toMatchObject({ name: 'Renamed', key: project.key })
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(project.updatedAt))
  })

  it('rejects an empty patch', async () => {
    const owner = await ctx.signUp()
    const project = await createProject(owner)

    const response = await call(owner, 'PATCH', `/${project.id}`)({})

    expect(response.statusCode).toBe(400)
  })

  it.each(['member', 'viewer'])('forbids a %s from updating or deleting', async (role) => {
    const owner = await ctx.signUp()
    const other = await ctx.signUp()
    const project = await createProject(owner)
    await addMember(owner, project, other, role)

    const update = await call(other, 'PATCH', `/${project.id}`)({ name: 'Hijacked' })
    const remove = await call(other, 'DELETE', `/${project.id}`)()

    expect(update.statusCode).toBe(403)
    expect(remove.statusCode).toBe(403)
  })

  it('lets the owner delete it', async () => {
    const owner = await ctx.signUp()
    const project = await createProject(owner)

    const response = await call(owner, 'DELETE', `/${project.id}`)()
    const afterDelete = await call(owner, 'GET', `/${project.id}`)()

    expect(response.statusCode).toBe(204)
    expect(afterDelete.statusCode).toBe(404)
  })
})

describe('project members', () => {
  it('lists members in the order they joined', async () => {
    const owner = await ctx.signUp('Olga')
    const member = await ctx.signUp('Max')
    const project = await createProject(owner)
    await addMember(owner, project, member, 'member')

    const response = await call(member, 'GET', `/${project.id}/members`)()

    expect(response.statusCode).toBe(200)
    const members = response.json<unknown[]>().map((item) => projectMemberSchema.parse(item))
    expect(members.map(({ name, role }) => ({ name, role }))).toEqual([
      { name: 'Olga', role: 'owner' },
      { name: 'Max', role: 'member' },
    ])
  })

  it('adds a user by email ignoring case, defaulting to the member role', async () => {
    const owner = await ctx.signUp()
    const invitee = await ctx.signUp()
    const project = await createProject(owner)

    const response = await call(
      owner,
      'POST',
      `/${project.id}/members`,
    )({
      email: invitee.email.toUpperCase(),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ userId: invitee.id, role: 'member' })
  })

  it('reports an unknown email and a duplicate member', async () => {
    const owner = await ctx.signUp()
    const project = await createProject(owner)

    const unknown = await call(
      owner,
      'POST',
      `/${project.id}/members`,
    )({
      email: 'ghost@example.com',
    })
    const duplicate = await call(owner, 'POST', `/${project.id}/members`)({ email: owner.email })

    expect(unknown.statusCode).toBe(404)
    expect(duplicate.statusCode).toBe(409)
  })

  it('forbids non-owners from adding members or changing roles', async () => {
    const owner = await ctx.signUp()
    const member = await ctx.signUp()
    const outsider = await ctx.signUp()
    const project = await createProject(owner)
    await addMember(owner, project, member, 'member')

    const add = await call(member, 'POST', `/${project.id}/members`)({ email: outsider.email })
    const promote = await call(
      member,
      'PATCH',
      `/${project.id}/members/${member.id}`,
    )({
      role: 'owner',
    })

    expect(add.statusCode).toBe(403)
    expect(promote.statusCode).toBe(403)
  })

  it('changes a role', async () => {
    const owner = await ctx.signUp()
    const member = await ctx.signUp('Max')
    const project = await createProject(owner)
    await addMember(owner, project, member, 'member')

    const response = await call(
      owner,
      'PATCH',
      `/${project.id}/members/${member.id}`,
    )({
      role: 'viewer',
    })

    expect(response.statusCode).toBe(200)
    expect(projectMemberSchema.parse(response.json())).toMatchObject({
      userId: member.id,
      name: 'Max',
      role: 'viewer',
    })
  })

  it('reports a role change for someone who is not a member', async () => {
    const owner = await ctx.signUp()
    const outsider = await ctx.signUp()
    const project = await createProject(owner)

    const response = await call(
      owner,
      'PATCH',
      `/${project.id}/members/${outsider.id}`,
    )({
      role: 'viewer',
    })

    expect(response.statusCode).toBe(404)
  })

  it('keeps at least one owner', async () => {
    const owner = await ctx.signUp()
    const second = await ctx.signUp()
    const project = await createProject(owner)
    await addMember(owner, project, second, 'member')
    const self = `/${project.id}/members/${owner.id}`

    const demoteLast = await call(owner, 'PATCH', self)({ role: 'member' })
    const leaveLast = await call(owner, 'DELETE', self)()
    await call(owner, 'PATCH', `/${project.id}/members/${second.id}`)({ role: 'owner' })
    const demoteWithSuccessor = await call(owner, 'PATCH', self)({ role: 'member' })

    expect(demoteLast.statusCode).toBe(409)
    expect(leaveLast.statusCode).toBe(409)
    expect(demoteWithSuccessor.statusCode).toBe(200)
  })

  it('lets an owner remove a member, who then loses access', async () => {
    const owner = await ctx.signUp()
    const member = await ctx.signUp()
    const project = await createProject(owner)
    await addMember(owner, project, member, 'member')

    const response = await call(owner, 'DELETE', `/${project.id}/members/${member.id}`)()
    const afterRemoval = await call(member, 'GET', `/${project.id}`)()
    const removeAgain = await call(owner, 'DELETE', `/${project.id}/members/${member.id}`)()

    expect(response.statusCode).toBe(204)
    expect(afterRemoval.statusCode).toBe(404)
    expect(removeAgain.statusCode).toBe(404)
  })

  it('lets a member leave but not remove others', async () => {
    const owner = await ctx.signUp()
    const member = await ctx.signUp()
    const viewer = await ctx.signUp()
    const project = await createProject(owner)
    await addMember(owner, project, member, 'member')
    await addMember(owner, project, viewer, 'viewer')

    const removeOther = await call(member, 'DELETE', `/${project.id}/members/${viewer.id}`)()
    const leave = await call(viewer, 'DELETE', `/${project.id}/members/${viewer.id}`)()

    expect(removeOther.statusCode).toBe(403)
    expect(leave.statusCode).toBe(204)
  })
})
