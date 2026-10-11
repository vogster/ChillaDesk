import type {
  CreateWikiPageRequest,
  UpdateWikiPageRequest,
  UserSummary,
  WikiListQuery,
  WikiPage,
  WikiPageSummary,
  WikiVersion,
  WikiVersionSummary,
} from '@chillawiki/shared'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'
import type { Db, Executor, Tx } from '../../db/client'
import { users, wikiPages, wikiPageVersions } from '../../db/schema'
import { conflict, invalid, isUniqueViolation, notFound } from '../../errors'
import { getProject } from '../projects/service'

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

// `%`, `_` and `\` are LIKE wildcards; a search for "100%" must match that text literally.
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&')

export async function listPages(
  db: Db,
  userId: string,
  projectId: string,
  query: WikiListQuery,
): Promise<WikiPageSummary[]> {
  await getProject(db, userId, projectId)
  const pattern = query.q ? `%${escapeLike(query.q)}%` : undefined
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

const titleTaken = (title: string) => conflict(`A page titled "${title}" already exists`)

async function assertParentInProject(db: Executor, projectId: string, parentId: string) {
  const [parent] = await db
    .select({ id: wikiPages.id })
    .from(wikiPages)
    .where(inProject(projectId, parentId))
  if (!parent) throw invalid('parentId must be a page of this project')
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
      if (input.parentId) await assertParentInProject(tx, projectId, input.parentId)
      const [created] = await tx
        .insert(wikiPages)
        .values({ ...input, projectId, updatedById: userId })
        .returning()
      if (!created) throw new Error('Insert returned no wiki page row')
      await recordVersion(tx, created, userId)
      return loadPage(tx, projectId, created.id)
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw titleTaken(input.title)
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
  if (!parents.has(parentId)) throw invalid('parentId must be a page of this project')

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
      if (textChanged) await recordVersion(tx, { id: pageId, version, title, content }, userId)
      return loadPage(tx, projectId, pageId)
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw titleTaken(changes.title ?? '')
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
    const [page] = await tx
      .select({ parentId: wikiPages.parentId })
      .from(wikiPages)
      .where(inProject(projectId, pageId))
      .for('update')
    if (!page) throw notFound('Wiki page')

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
