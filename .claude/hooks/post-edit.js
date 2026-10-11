#!/usr/bin/env node
/**
 * PostToolUse hook for Edit|Write.
 * Replaces the everything-claude-code plugin hooks whose matchers never fire:
 * - formats JS/TS files with the project's local Prettier
 * - type-checks TS files with the project's local tsc and reports errors back to Claude
 *
 * Uses only locally installed binaries (node_modules/.bin), so it never triggers npx downloads.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const FORMAT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const TYPECHECK_EXT = /\.(ts|tsx)$/
const MAX_ERROR_LINES = 10

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
  })
}

function findUp(startDir, fileName) {
  let dir = startDir
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, fileName))) return dir
    dir = path.dirname(dir)
  }
  return null
}

function localBin(rootDir, name) {
  const suffix = process.platform === 'win32' ? '.cmd' : ''
  const bin = path.join(rootDir, 'node_modules', '.bin', name + suffix)
  return fs.existsSync(bin) ? bin : null
}

function run(bin, args, cwd) {
  return execFileSync(bin, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    timeout: 60000,
  })
}

function formatFile(filePath, rootDir) {
  const prettier = localBin(rootDir, 'prettier')
  if (!prettier) return
  try {
    run(prettier, ['--write', filePath], rootDir)
  } catch {
    // Formatting is best-effort; syntax errors surface via tsc or the next edit.
  }
}

function typecheck(filePath) {
  const tsconfigDir = findUp(path.dirname(filePath), 'tsconfig.json')
  if (!tsconfigDir) return []
  const pkgDir = findUp(tsconfigDir, 'package.json') || tsconfigDir
  const tsc = localBin(pkgDir, 'tsc')
  if (!tsc) return []
  try {
    run(tsc, ['--noEmit', '--pretty', 'false'], tsconfigDir)
    return []
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`
    const relative = path.relative(tsconfigDir, filePath).replace(/\\/g, '/')
    return output
      .split(/\r?\n/)
      .filter((line) => line.replace(/\\/g, '/').includes(relative))
      .slice(0, MAX_ERROR_LINES)
  }
}

async function main() {
  const input = JSON.parse((await readStdin()) || '{}')
  const filePath = input.tool_input && input.tool_input.file_path
  if (!filePath || !FORMAT_EXT.test(filePath) || !fs.existsSync(filePath)) return

  const rootDir = findUp(path.dirname(filePath), 'package.json')
  if (!rootDir) return

  formatFile(filePath, rootDir)

  if (!TYPECHECK_EXT.test(filePath)) return
  const errors = typecheck(filePath)
  if (errors.length > 0) {
    process.stderr.write(`[Hook] TypeScript errors in ${filePath}:\n${errors.join('\n')}\n`)
    process.exit(2)
  }
}

main().catch((error) => {
  process.stderr.write(`[Hook] post-edit failed: ${error.message}\n`)
})
