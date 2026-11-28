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

// The real path of the session's project folder, so a worktree and its main checkout never share a key whatever cwd
// the session reports. Read on every tick, never kept: a desktop app session starts in a spare folder and is then moved
// into the project (which deletes the spare), and `/cd` or a worktree move change it too.
async function folderOf($: EngineInterface): Promise<string | undefined> {
  const root = await $.session.root().catch(() => '.')
  return (await $.fs.stat(root, { resolve: true }).catch(() => null))?.realPath
}

// The session's folder is now `to`: it gives up the folder it left, so the newest session there takes it, and reads
// `to` by the usual rules (owns, takeNew), from that folder's own position.
export async function moveTo($: EngineInterface, me: Me, from: string | undefined, to: string | undefined): Promise<string | undefined> {
  if (from && from !== to) await release($, me, from)
  return to
}

// The status under the prompt, drawn green (the theme's `success`) while this session receives the folder's comments
// and red (`error`) while another one does.
// The dot is an emoji: the desktop draws a chip nested in another plugin's hint as a grey pill, dropping Text colours,
// and an emoji keeps its own.
export const statusFor = (isOwner: boolean, version: string) => `${isOwner ? '🟢' : '🔴'} Comment-mod v${version}`
export const colorFor = (isOwner: boolean) => (isOwner ? 'success' : 'error')
// The details row above the prompt, opened by a click on the status: where the comments go now.
export const detailFor = (isOwner: boolean) =>
  isOwner ? 'This session receives the dev overlay comments' : 'Another session receives the dev overlay comments'

// What is drawn: whether this session receives the folder's comments, unknown (nothing drawn) until the first tick;
// and whether the details row above the prompt is open.
type View = { isOwner?: boolean; isOpen?: boolean }

function show($: EngineInterface, view: View, isOwner: boolean): void {
  if (view.isOwner === isOwner) return
  view.isOwner = isOwner
  $.ui.invalidate('ui.render')
}

function setOpen($: EngineInterface, view: View, isOpen: boolean): void {
  view.isOpen = isOpen
  $.ui.invalidate('ui.render')
}

// `/comments here` and the row's button: this session takes the folder's comments.
async function takeHere($: EngineInterface, me: Me, view: View, dir: string): Promise<void> {
  await claim($, me, dir, await $.clock.now())
  show($, view, true)
}

export const register: Register = on => {
  let me: Me | undefined
  let folder: string | undefined
  const view: View = {}
  let version = '?'

  on('session.start', async ($, e, next) => {
    me = { session: await $.session.id(), startedAt: await $.clock.now() }
    version = await $.fs
      .read(`${$.plugin.root}/.claude-plugin/plugin.json`)
      .then(text => String(JSON.parse(text).version ?? '?'))
      .catch(() => '?')
    // 0.3.1 and earlier pinned a status line; this version draws on the hint line instead.
    $.ui.status(undefined)
    await $.command.register({
      name: 'comments',
      description: 'Shows which session receives the dev server overlay comments; `here` makes it this one',
      argumentHint: '[here]',
      immediate: true,
    })

    // ponytail: polls every 2s; a file watch if the API grows one
    $.clock.every(2000, async () => {
      if (!me) return
      const dir = (folder = await moveTo($, me, folder, await folderOf($)))
      if (!dir) return
      const isOwner = await owns($, me, dir)
      show($, view, isOwner)
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
    if (!me) return { text: 'Comments: this session has no folder to read.' }
    const dir = (folder = await moveTo($, me, folder, await folderOf($)))
    if (!dir) return { text: 'Comments: this session has no folder to read.' }
    if (e.args.trim() === 'here') await takeHere($, me, view, dir)
    const isOwner = await owns($, me, dir)
    return {
      text: isOwner
        ? `Comments from ${dir}/${FILE} come to this session.`
        : `Another session receives the comments from ${dir}/${FILE}. Run /comments here to take them.`,
    }
  })

  // A chip on the hint line under the chat box, beside the app's own hints: green while this session receives the
  // comments, red while another one does. The desktop draws that line whole, hidden Boxes included, so nothing there
  // waits for a hover: a click opens the details row above the prompt, where buttons draw as meant.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const engine = await next(e)
    const isOwner = view.isOwner
    if (isOwner === undefined) return engine
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={2}>
        {engine}
        {/* No `label`: given one, the desktop draws it plain, in place of the coloured Text. */}
        <Button key="comment-mod" plain onPress={() => setOpen($, view, !view.isOpen)}>
          <Text color={colorFor(isOwner)}>{statusFor(isOwner, version)}</Text>
        </Button>
      </Box>
    )
  })

  // The details, above the prompt while opened: where the comments go, Move to this session while another session
  // receives them, and Hide.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    const isOwner = view.isOwner
    if (e.props.hasSurvey || !view.isOpen || isOwner === undefined) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={colorFor(isOwner)}>●</Text>
        <Text>{detailFor(isOwner)}</Text>
        {isOwner ? null : (
          <Button key="move" label="Move to this session" plain onPress={() => (me && folder ? takeHere($, me, view, folder) : undefined)} />
        )}
        <Button key="hide" label="Hide" plain dimColor onPress={() => setOpen($, view, false)} />
      </Box>
    )
  })

  // `clear` keeps the process (and the person at it) going under a new id, so it keeps its folders.
  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear' && me && folder) await release($, me, folder)
    return next(e)
  })
}
