import type { EngineInterface, Register } from 'claude-code'

import { type Comment, promptFor, take } from './comments'

// Written by the app's dev-only overlay (templates/nextjs: app/dev-comments.tsx → /api/dev/comments), relative to the
// folder the session reads files in: in a git worktree, the worktree's, never the main checkout's.
const FILE = '.scratch/preview-comments.jsonl'

// The session asking.
export type Me = { session: string; startedAt: number }
type Claim = { session: string; at: number }

// One session receives a folder's comments: the one with the latest claim. Starting a session claims the folders it
// polls, so with no `/comments here` the newest session receives; a session started earlier takes them back by claiming.
export async function owns($: EngineInterface, me: Me, folder: string): Promise<boolean> {
  const owner = (await $.store.get(`owner:${folder}`)) as Claim | undefined
  if (owner && owner.at >= me.startedAt) return owner.session === me.session
  await $.store.set(`owner:${folder}`, { session: me.session, at: me.startedAt })
  return true
}

export async function claim($: EngineInterface, me: Me, folder: string, now: number): Promise<void> {
  await $.store.set(`owner:${folder}`, { session: me.session, at: now })
}

// A session that ends gives its folders up, so the newest session left takes them on its next tick.
export async function release($: EngineInterface, me: Me, folder: string): Promise<void> {
  const owner = (await $.store.get(`owner:${folder}`)) as Claim | undefined
  if (owner?.session === me.session) await $.store.delete(`owner:${folder}`)
}

// The comments in `file` that no session has sent yet, marked sent. The position is kept per folder by its real path:
// keyed by the session's cwd, a worktree session (whose cwd can name the main checkout) and a main-checkout session
// shared one, reset each other's count and resent everything. `read:` and not the old `offset:` keys, which hold
// those broken counts.
export async function takeNew($: EngineInterface, me: Me, folder: string, file: string): Promise<Comment[]> {
  const at = `read:${folder}`
  const stored = await $.store.get(at)
  // First time in this folder: start at the end, so comments from before the plugin was installed aren't resent.
  if (stored == null) {
    await $.store.set(at, take(file, 0).offset)
    return []
  }
  const before = Number(stored)
  const { fresh, offset } = take(file, before)
  if (offset === before) return []
  // ponytail: the store has no compare-and-set, so the owner and position are read again just before the write; two
  // ticks can still both send if they land between these two calls. A lock file via $.fs if that's ever seen.
  const [owner, now] = await Promise.all([$.store.get(`owner:${folder}`), $.store.get(at)])
  if ((owner as Claim | undefined)?.session !== me.session || Number(now) !== before) return []
  await $.store.set(at, offset)
  return fresh
}

// The real path of the folder the session reads files in, so a worktree and its main checkout never share a key
// whatever cwd the session reports.
async function folderOf($: EngineInterface): Promise<string | undefined> {
  return (await $.fs.stat('.', { resolve: true }).catch(() => null))?.realPath
}

export const register: Register = on => {
  let me: Me | undefined
  let folder: string | undefined
  let shown: string | undefined

  on('session.start', async ($, e, next) => {
    me = { session: await $.session.id(), startedAt: await $.clock.now() }
    await $.command.register({
      name: 'comments',
      description: 'Shows which session receives the dev server overlay comments; `here` makes it this one',
      argumentHint: '[here]',
      immediate: true,
    })

    // ponytail: polls every 2s; a file watch if the API grows one
    $.clock.every(2000, async () => {
      const dir = (folder ??= await folderOf($))
      if (!dir || !me) return
      const isOwner = await owns($, me, dir)
      const status = isOwner ? 'Comments: here' : 'Comments: another session'
      if (status !== shown) $.ui.status((shown = status))
      if (!isOwner) return

      const file = await $.fs.read(`${dir}/${FILE}`).catch(() => null)
      if (typeof file !== 'string') return
      const fresh = await takeNew($, me, dir, file)
      if (!fresh.length) return

      $.ui.toast(`${fresh.length} preview comment${fresh.length > 1 ? 's' : ''} sent to Claude`)
      await $.prompt.submit({ text: promptFor(fresh) })
    })

    return next(e)
  })

  on('command.run', { command: 'comments' }, async ($, e) => {
    const dir = (folder ??= await folderOf($))
    if (!dir || !me) return { text: 'Comments: this session has no folder to read.' }
    if (e.args.trim() === 'here') {
      await claim($, me, dir, await $.clock.now())
      $.ui.status((shown = 'Comments: here'))
    }
    const isOwner = await owns($, me, dir)
    return {
      text: isOwner
        ? `Comments from ${dir}/${FILE} come to this session.`
        : `Another session receives the comments from ${dir}/${FILE}. Run /comments here to take them.`,
    }
  })

  // `clear` keeps the process (and the person at it) going under a new id, so it keeps its folders.
  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear' && me && folder) await release($, me, folder)
    return next(e)
  })
}
