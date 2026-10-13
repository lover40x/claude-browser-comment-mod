export type Comment = { at: string; path: string; selector: string; text: string; comment: string }

// The lines past `offset`, parsed. A last line with no newline yet is still being written and waits. A file
// shorter than the offset was cleared or replaced, so it is read from the top.
export function take(file: string, offset: number): { fresh: Comment[]; offset: number } {
  const lines = file.split('\n')
  lines.pop()
  const from = lines.length < offset ? 0 : offset
  const fresh = lines.slice(from).flatMap(line => {
    try {
      return [JSON.parse(line) as Comment]
    } catch {
      return []
    }
  })
  return { fresh, offset: lines.length }
}

export function promptFor(comments: Comment[]): string {
  const items = comments.map(c => {
    const quoted = c.text ? ` ("${c.text}")` : ''
    return `- On \`${c.path}\`, element \`${c.selector}\`${quoted}:\n  ${c.comment.replace(/\n/g, '\n  ')}`
  })
  const heading = comments.length > 1 ? 'Preview comments' : 'Preview comment'
  return `[${heading} from the dev server overlay]\n\n${items.join('\n\n')}`
}
