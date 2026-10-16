import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { promptFor, take } from './comments'
import { claim, type Me, owns, release, takeNew } from './register'

const line = (comment: string) =>
  JSON.stringify({ at: 't', path: '/dashboard', selector: 'main > h1', text: 'Overview', comment }) + '\n'

test('takes only the lines past the offset', async () => {
  const { fresh, offset } = take(line('a') + line('b'), 1)
  expect(fresh.map(c => c.comment)).toEqual(['b'])
  expect(offset).toBe(2)
})

test('leaves a half-written last line for the next read', async () => {
  const { fresh, offset } = take(line('a') + '{"at":', 0)
  expect(fresh.length).toBe(1)
  expect(offset).toBe(1)
})

test('reads from the top when the file was cleared', async () => {
  const { fresh } = take(line('new'), 5)
  expect(fresh.map(c => c.comment)).toEqual(['new'])
})

test('the prompt names the page, element and comment', async () => {
  const text = promptFor(take(line('Make this smaller'), 0).fresh)
  expect(text).toContain('/dashboard')
  expect(text).toContain('main > h1')
  expect(text).toContain('Make this smaller')
})

// The plugin's store, which every session shares: the test's sessions share one `$` over it, and differ by who they
// are (`Me`) and the folder they read. Each call yields, as the engine's does.
const shared = (entries: Record<string, unknown> = {}) => {
  const map = new Map(Object.entries(entries))
  const store = {
    get: async (key: string) => (await null, map.get(key)),
    set: async (key: string, value: unknown) => void (await null, map.set(key, value)),
    delete: async (key: string) => void (await null, map.delete(key)),
  }
  return { store } as unknown as EngineInterface
}

const lines = (n: number, from = 0) => Array.from({ length: n }, (_, i) => line(`c${from + i}`)).join('')

// One 2-second tick of one session, as register.ts runs it: what it submits.
const tick = async ($: EngineInterface, me: Me, folder: string, file: string) =>
  (await owns($, me, folder)) ? (await takeNew($, me, folder, file)).map(c => c.comment) : []

test('a worktree and the main checkout never reset each other, so nothing is resent', async () => {
  const $ = shared()
  const main = { session: 'main', startedAt: 1 }
  const worktree = { session: 'wt', startedAt: 2 }
  let mainFile = lines(12)
  const sent: string[] = []
  for (let i = 0; i < 5; i++) {
    sent.push(...(await tick($, main, '/repo', mainFile)))
    sent.push(...(await tick($, worktree, '/repo/.claude/worktrees/x', lines(63))))
    if (i === 2) mainFile += line('new')
  }
  expect(sent).toEqual(['new'])
})

test('two sessions ticking at once in one folder send a comment once', async () => {
  const $ = shared()
  const a = { session: 'a', startedAt: 1 }
  const b = { session: 'b', startedAt: 2 }
  await Promise.all([tick($, a, '/repo', lines(3)), tick($, b, '/repo', lines(3))])
  const sent = await Promise.all([tick($, a, '/repo', lines(4)), tick($, b, '/repo', lines(4))])
  expect(sent.flat()).toEqual(['c3'])
})

test('two sessions racing to claim an unowned folder send a comment once', async () => {
  const $ = shared({ 'read:/repo': 3 })
  const sent = await Promise.all([
    tick($, { session: 'a', startedAt: 1 }, '/repo', lines(4)),
    tick($, { session: 'b', startedAt: 2 }, '/repo', lines(4)),
  ])
  expect(sent.flat()).toEqual(['c3'])
})

test('the newest session receives, until another claims the folder', async () => {
  const $ = shared()
  const old = { session: 'old', startedAt: 1 }
  const newer = { session: 'new', startedAt: 2 }
  expect(await owns($, old, '/repo')).toBe(true)
  expect(await owns($, newer, '/repo')).toBe(true)
  expect(await owns($, old, '/repo')).toBe(false)

  await claim($, old, '/repo', 3)
  expect(await owns($, newer, '/repo')).toBe(false)
  expect(await owns($, old, '/repo')).toBe(true)

  // A session started after the claim is the most recent claim.
  expect(await owns($, { session: 'newest', startedAt: 4 }, '/repo')).toBe(true)
  expect(await owns($, old, '/repo')).toBe(false)
})

test('only the receiving session sends, and a folder it leaves goes to the newest', async () => {
  const $ = shared()
  const a = { session: 'a', startedAt: 1 }
  const b = { session: 'b', startedAt: 2 }
  await tick($, a, '/repo', lines(1))
  await tick($, b, '/repo', lines(1))
  await claim($, a, '/repo', 3)
  expect(await tick($, b, '/repo', lines(2))).toEqual([])
  expect(await tick($, a, '/repo', lines(2))).toEqual(['c1'])

  await release($, a, '/repo')
  expect(await tick($, b, '/repo', lines(3))).toEqual(['c2'])
})
