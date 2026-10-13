import { expect, test } from 'claude-code/testing'

import { promptFor, take } from './comments'

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
