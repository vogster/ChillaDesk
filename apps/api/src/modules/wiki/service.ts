import type {
  CreateWikiPageRequest,
  UpdateWikiPageRequest,
  UserSummary,
  WikiListQuery,
  WikiPage,
  WikiPageSummary,
  WikiVersion,
  WikiVersionSummary,
} from '@chilladesk/shared'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { Db, Executor, Tx } from '../../db/client'
import { containsPattern } from '../../db/like'
import { projects, users, wikiPages, wikiPageVersions } from '../../db/schema'
import { conflict, invalid, isForeignKeyViolation, isUniqueViolation, notFound } from '../../errors'
import { notifyMentions } from '../notifications/service'
import { getProject } from '../projects/service'
import { queueWebhookEvent } from '../webhooks/events'

const author = { id: users.id, name: users.name, email: users.email }

const summaryColumns = {
  id: wikiPages.id,
  projectId: wikiPages.projectId,
  parentId: wikiPages.parentId,
  title: wikiPages.title,
  updatedAt: wikiPages.updatedAt,
}

type SummaryRow = Pick<
  typeof wikiPages.$inferSelect,
  'id' | 'projectId' | 'parentId' | 'title' | 'updatedAt'
>

function toSummary(row: SummaryRow): WikiPageSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toPage(page: typeof wikiPages.$inferSelect, updatedBy: UserSummary | null): WikiPage {
  return {
    ...toSummary(page),
    content: page.content,
    version: page.version,
    updatedBy,
    createdAt: page.createdAt.toISOString(),
  }
}

const inProject = (projectId: string, pageId: string) =>
  and(eq(wikiPages.projectId, projectId), eq(wikiPages.id, pageId))

/** Loads a page without checking access; the caller has already authorised the project. */
async function loadPage(db: Executor, projectId: string, pageId: string): Promise<WikiPage> {
  const [row] = await db
    .select({ page: wikiPages, updatedBy: author })
    .from(wikiPages)
    .leftJoin(users, eq(users.id, wikiPages.updatedById))
    .where(inProject(projectId, pageId))
  if (!row) throw notFound('Wiki page')
  return toPage(row.page, row.updatedBy)
}

export async function listPages(
  db: Db,
  userId: string,
  projectId: string,
  query: WikiListQuery,
): Promise<WikiPageSummary[]> {
  await getProject(db, userId, projectId)
  const pattern = query.q ? containsPattern(query.q) : undefined
  const rows = await db
    .select(summaryColumns)
    .from(wikiPages)
    .where(
      and(
        eq(wikiPages.projectId, projectId),
        pattern
          ? or(ilike(wikiPages.title, pattern), ilike(wikiPages.content, pattern))
          : undefined,
      ),
    )
    .orderBy(sql`lower(${wikiPages.title})`)
  return rows.map(toSummary)
}

export async function getPage(
  db: Db,
  userId: string,
  projectId: string,
  pageId: string,
): Promise<WikiPage> {
  await getProject(db, userId, projectId)
  return loadPage(db, projectId, pageId)
}

/**
 * Makes changes to a project's page tree (nesting, moving, deleting) run one at a time.
 * Otherwise two moves could each pass the cycle check and together make A the parent of B
 * and B the parent of A, or a page could be nested under one that is being deleted.
 * Always taken before any page row lock.
 */
async function lockTree(tx: Tx, projectId: string): Promise<void> {
  await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('update')
}

const PARENT_GONE = 'parentId must be a page of this project'

const titleTaken = (title: string) => conflict(`A page titled "${title}" already exists`)

async function assertParentInProject(db: Executor, projectId: string, parentId: string) {
  const [parent] = await db
    .select({ id: wikiPages.id })
    .from(wikiPages)
    .where(inProject(projectId, parentId))
  if (!parent) throw invalid(PARENT_GONE)
}

function recordVersion(
  tx: Tx,
  page: { id: string; version: number; title: string; content: string },
  authorId: string,
) {
  return tx.insert(wikiPageVersions).values({
    pageId: page.id,
    version: page.version,
    title: page.title,
    content: page.content,
    authorId,
  })
}

export async function createPage(
  db: Db,
  userId: string,
  projectId: string,
  input: CreateWikiPageRequest,
): Promise<WikiPage> {
  await getProject(db, userId, projectId, 'member')
  try {
    return await db.transaction(async (tx) => {
      if (input.parentId) {
        await lockTree(tx, projectId)
        await assertParentInProject(tx, projectId, input.parentId)
      }
      const [created] = await tx
        .insert(wikiPages)
        .values({ ...input, projectId, updatedById: userId })
        .returning()
      if (!created) throw new Error('Insert returned no wiki page row')
      await recordVersion(tx, created, userId)
      await notifyMentions(
        tx,
        { projectId, actorId: userId, wikiPageId: created.id },
        created.content,
      )
      await queueWebhookEvent(tx, projectId, userId, 'page.created', {
        page: { id: created.id, title: created.title },
      })
      return loadPage(tx, projectId, created.id)
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw titleTaken(input.title)
    if (isForeignKeyViolation(error)) throw invalid(PARENT_GONE)
    throw error
  }
}

/** Walks up from `parentId`; reaching `pageId` means the move would make the page its own ancestor. */
async function assertNoCycle(tx: Tx, projectId: string, pageId: string, parentId: string) {
  const parents = new Map(
    (
      await tx
        .select({ id: wikiPages.id, parentId: wikiPages.parentId })
        .from(wikiPages)
        .where(eq(wikiPages.projectId, projectId))
    ).map((page) => [page.id, page.parentId]),
  )
  if (!parents.has(parentId)) throw invalid(PARENT_GONE)

  const seen = new Set<string>()
  for (let current: string | null = parentId; current; current = parents.get(current) ?? null) {
    if (current === pageId) throw invalid('A page cannot be moved under itself or its own subpages')
    if (seen.has(current)) break
    seen.add(current)
  }
}

export async function updatePage(
  db: Db,
  userId: string,
  projectId: string,
  pageId: string,
  { baseVersion, ...changes }: UpdateWikiPageRequest,
): Promise<WikiPage> {
  await getProject(db, userId, projectId, 'member')
  try {
    return await db.transaction(async (tx) => {
      if (changes.parentId !== undefined) await lockTree(tx, projectId)
      // Locked so that two saves are compared against the stored version one at a time.
      const [current] = await tx
        .select()
        .from(wikiPages)
        .where(inProject(projectId, pageId))
        .for('update')
      if (!current) throw notFound('Wiki page')
      if (current.version !== baseVersion) {
        throw conflict(
          'This page was changed by someone else while you were editing. Reload it to see the latest version.',
          // Lets a client tell a stale edit from the other 409 here, a title that is taken.
          [{ path: 'baseVersion', message: `The page is now at version ${current.version}` }],
        )
      }
      if (changes.parentId) await assertNoCycle(tx, projectId, pageId, changes.parentId)

      const title = changes.title ?? current.title
      const content = changes.content ?? current.content
      const textChanged = title !== current.title || content !== current.content
      const version = textChanged ? current.version + 1 : current.version

      await tx
        .update(wikiPages)
        .set({
          title,
          content,
          version,
          ...(changes.parentId !== undefined ? { parentId: changes.parentId } : {}),
          ...(textChanged ? { updatedById: userId, updatedAt: new Date() } : {}),
        })
        .where(eq(wikiPages.id, pageId))
      if (textChanged) {
        await recordVersion(tx, { id: pageId, version, title, content }, userId)
        await notifyMentions(
          tx,
          { projectId, actorId: userId, wikiPageId: pageId },
          content,
          current.content,
        )
        await queueWebhookEvent(tx, projectId, userId, 'page.updated', {
          page: { id: pageId, title },
        })
      }
      return loadPage(tx, projectId, pageId)
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw titleTaken(changes.title ?? '')
    if (isForeignKeyViolation(error)) throw invalid(PARENT_GONE)
    throw error
  }
}

export async function deletePage(
  db: Db,
  userId: string,
  projectId: string,
  pageId: string,
): Promise<void> {
  await getProject(db, userId, projectId, 'member')
  await db.transaction(async (tx) => {
    await lockTree(tx, projectId)
    const [page] = await tx
      .select({ parentId: wikiPages.parentId, title: wikiPages.title })
      .from(wikiPages)
      .where(inProject(projectId, pageId))
      .for('update')
    if (!page) throw notFound('Wiki page')
    await queueWebhookEvent(tx, projectId, userId, 'page.deleted', {
      page: { id: pageId, title: page.title },
    })

    // Subpages are kept: they take the deleted page's place in the tree.
    await tx
      .update(wikiPages)
      .set({ parentId: page.parentId })
      .where(eq(wikiPages.parentId, pageId))
    await tx.delete(wikiPages).where(eq(wikiPages.id, pageId))
  })
}

async function assertPageInProject(db: Executor, projectId: string, pageId: string) {
  const [page] = await db
    .select({ id: wikiPages.id })
    .from(wikiPages)
    .where(inProject(projectId, pageId))
  if (!page) throw notFound('Wiki page')
}

const versionColumns = {
  version: wikiPageVersions.version,
  title: wikiPageVersions.title,
  createdAt: wikiPageVersions.createdAt,
  author,
}

export async function listVersions(
  db: Db,
  userId: string,
  projectId: string,
  pageId: string,
): Promise<WikiVersionSummary[]> {
  await getProject(db, userId, projectId)
  await assertPageInProject(db, projectId, pageId)
  const rows = await db
    .select(versionColumns)
    .from(wikiPageVersions)
    .leftJoin(users, eq(users.id, wikiPageVersions.authorId))
    .where(eq(wikiPageVersions.pageId, pageId))
    .orderBy(desc(wikiPageVersions.version))
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
}

export async function getVersion(
  db: Db,
  userId: string,
  projectId: string,
  pageId: string,
  version: number,
): Promise<WikiVersion> {
  await getProject(db, userId, projectId)
  await assertPageInProject(db, projectId, pageId)
  const [row] = await db
    .select({ ...versionColumns, content: wikiPageVersions.content })
    .from(wikiPageVersions)
    .leftJoin(users, eq(users.id, wikiPageVersions.authorId))
    .where(and(eq(wikiPageVersions.pageId, pageId), eq(wikiPageVersions.version, version)))
  if (!row) throw notFound('Version')
  return { ...row, createdAt: row.createdAt.toISOString() }
}
