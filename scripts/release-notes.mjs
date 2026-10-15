// Prints the text of a GitHub release: the section of CHANGELOG.md for that version, and how
// to install exactly that version.
//
//   node scripts/release-notes.mjs 0.4.0 > notes.md
import { readFileSync } from 'node:fs'

const version = (process.argv[2] ?? '').replace(/^v/, '')
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/release-notes.mjs <version, like 0.4.0>')
  process.exit(1)
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
const lines = changelog.split(/\r?\n/)
const start = lines.findIndex((line) => line.trim() === `## ${version}`)
if (start < 0) {
  console.error(`CHANGELOG.md has no section "## ${version}"`)
  process.exit(1)
}
const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
const notes = lines
  .slice(start + 1, end < 0 ? undefined : end)
  .join('\n')
  .trim()

const [major, minor] = version.split('.').map(Number)
const atLeast = (wantedMinor) => major > 0 || minor >= wantedMinor
const image = 'ghcr.io/vogster/chilladesk'
const repo = `https://github.com/vogster/ChillaDesk/blob/v${version}`
const sections = [notes]
// The single-container image exists from 0.3.0 on, the separate ones from 0.2.0 on.
if (atLeast(2)) {
  const install = ['### Install this version']
  if (atLeast(3)) {
    install.push(
      [
        'One container, data in `./chilladesk`:',
        '',
        '```bash',
        'docker run -d --name chilladesk --restart unless-stopped \\',
        '  -v ./chilladesk:/data -p 8080:3000 \\',
        `  ${image}:${version}`,
        '```',
      ].join('\n'),
    )
  }
  // deploy/docker-compose.yml came with 0.3.0; before, the one in the root of a checkout.
  const compose = atLeast(3) ? 'deploy/docker-compose.yml' : 'docker-compose.yml'
  install.push(
    `With PostgreSQL: set \`CHILLADESK_VERSION=${version}\` in the \`.env\` next to ` +
      `[${compose}](${repo}/${compose}) and run \`docker compose pull && docker compose up -d\`. ` +
      `Images: \`${image}-api:${version}\`, \`${image}-web:${version}\`.`,
  )
  sections.push(install.join('\n\n'))
}
sections.push(
  'Back up your data before upgrading; database migrations run when the new version starts.',
)
console.log(sections.join('\n\n'))
