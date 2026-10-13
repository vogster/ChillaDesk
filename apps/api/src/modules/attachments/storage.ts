import { randomUUID } from 'node:crypto'
import { createReadStream, type ReadStream } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Where the bytes of attachments live. Files are named by a random key the server makes
 * up; nothing a user typed ever becomes part of a path.
 */
export interface FileStore {
  /** Stores the bytes and returns the key to find them by. */
  save(content: Buffer): Promise<string>
  open(key: string): ReadStream
  remove(key: string): Promise<void>
  /** Deletes stored files that nothing refers to any more; returns how many. */
  sweep(isReferenced: (keys: string[]) => Promise<Set<string>>, now?: Date): Promise<number>
}

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Below this many, even a sweep of everything is taken for ordinary cleaning up. */
const SWEEP_SUSPICIOUS_COUNT = 20

/** A file this young may belong to an upload whose row is not committed yet. */
const SWEEP_MIN_AGE_MS = 60 * 60 * 1000

export function createFileStore(directory: string): FileStore {
  const root = resolve(directory)
  const pathOf = (key: string): string => {
    // Keys only ever come from `save`, but a path is not built from anything unchecked.
    if (!KEY.test(key)) throw new Error('Invalid storage key')
    return join(root, key)
  }

  return {
    async save(content) {
      await mkdir(root, { recursive: true })
      const key = randomUUID()
      // `wx`: never overwrite, even in the practically impossible case of a repeated key.
      await writeFile(pathOf(key), content, { flag: 'wx' })
      return key
    },

    open: (key) => createReadStream(pathOf(key)),

    async remove(key) {
      await rm(pathOf(key), { force: true })
    },

    async sweep(isReferenced, now = new Date()) {
      let names: string[]
      try {
        names = (await readdir(root)).filter((name) => KEY.test(name))
      } catch {
        return 0
      }
      const referenced = await isReferenced(names)
      const orphans: string[] = []
      for (const name of names) {
        if (referenced.has(name)) continue
        const info = await stat(pathOf(name)).catch(() => null)
        if (info && now.getTime() - info.mtimeMs >= SWEEP_MIN_AGE_MS) orphans.push(name)
      }
      // Most of the store being unreferenced looks less like leftovers than like the wrong
      // database (a restore, a misconfiguration). Deleting cannot be undone, so it is refused.
      if (orphans.length >= SWEEP_SUSPICIOUS_COUNT && orphans.length > names.length / 2) {
        throw new Error(
          `Refusing to remove ${orphans.length} of ${names.length} stored files: check that ` +
            'the database is the one these files belong to',
        )
      }
      for (const name of orphans) await rm(pathOf(name), { force: true })
      return orphans.length
    },
  }
}
