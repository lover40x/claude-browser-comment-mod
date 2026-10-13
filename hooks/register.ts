import type { Register } from 'claude-code'

import { promptFor, take } from './comments'

// Written by the app's dev-only overlay (templates/nextjs: app/dev-comments.tsx → /api/dev/comments), relative to the session's cwd.
const FILE = '.scratch/preview-comments.jsonl'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const key = `offset:${await $.session.cwd()}`

    // ponytail: polls every 2s; a file watch if the API grows one
    $.clock.every(2000, async () => {
      const file = await $.fs.read(FILE).catch(() => null)
      if (typeof file !== 'string') return

      const stored = await $.store.get(key)
      // First time in this folder: start at the end, so comments from before the plugin was installed aren't resent.
      if (stored == null) return void (await $.store.set(key, take(file, 0).offset))
      const before = Number(stored)
      const { fresh, offset } = take(file, before)
      if (offset !== before) await $.store.set(key, offset)
      if (!fresh.length) return

      $.ui.toast(`${fresh.length} preview comment${fresh.length > 1 ? 's' : ''} sent to Claude`)
      await $.prompt.submit({ text: promptFor(fresh) })
    })

    return next(e)
  })
}
