# Claude Browser Comment Mod

Comment on a running app like on an Artifact: click any element in the dev server's page, write a comment, and it
reaches the Claude Code session working in that folder as a prompt, with the page's path, the element's selector and
its text.

Two halves:

- **The plugin** (this folder): every 2 seconds the session that receives a folder's comments reads
  `.scratch/preview-comments.jsonl` there and submits the lines it hasn't sent yet. It remembers how far it got per
  folder, so a restart doesn't send them again.
- **The overlay** (in the app): a dev-only button that writes those lines. `templates/nextjs/` has it for a Next.js
  App Router app.

## Install

In a terminal session (`claude`), once:

```
/plugin install claude-browser-comment-mod --marketplace lover40x/claude-browser-comment-mod
```

Answer `y` to add the marketplace and pick the user scope: it then runs in every session. From a local copy, name its
folder instead: `--marketplace ~/path/to/claude-browser-comment-mod`.

## Add the overlay to a Next.js app

1. Copy `templates/nextjs/app/dev-comments.tsx` to `app/dev-comments.tsx`, and
   `templates/nextjs/app/api/dev/comments/route.ts` to `app/api/dev/comments/route.ts`.
2. In `app/layout.tsx`, import it and mount it inside `<body>`, under `next dev` only:

   ```tsx
   import DevComments from "./dev-comments";
   // …
   {process.env.NODE_ENV === "development" && <DevComments />}
   ```
3. Keep `.scratch/` out of git (`.gitignore`).

The route answers 404 outside `next dev`. Another stack needs only something that appends one JSON line per comment
to `.scratch/preview-comments.jsonl`, relative to the folder the Claude session runs in:

```json
{"at":"2026-10-14T04:00:00Z","path":"/dashboard","selector":"main > section.card","text":"Revenue by month","comment":"make this tile smaller"}
```

The dev server and the Claude session must share that folder: comments from a server started in another worktree
land in that worktree's `.scratch/`. A session in a git worktree reads the worktree's file only, never the main
checkout's: when the dev server runs in the main checkout, comment to a session there.

## Which session receives the comments

One session per folder receives its comments; the others leave the file alone. The status line says which:
`Comments: here` or `Comments: another session`.

- By default the newest session started in the folder receives them.
- `/comments here` makes this session receive them, until a session is started there later or another runs it.
- `/comments` alone says who receives them.
- When the receiving session ends, the newest one left takes over within 2 seconds (after a crash, run `/comments here`).

After installing or updating the plugin, restart the sessions already open: a running session keeps the version it
started with, and one from before 0.3.0 still sends every folder's comments to whichever session reads first.

## Check it

```
claude plugin validate .
claude plugin test .
```

## License

MIT, see [LICENSE](LICENSE).
