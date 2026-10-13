# Claude Browser Comment Mod

Comment on a running app like on an Artifact: click any element in the dev server's page, write a comment, and it
reaches the Claude Code session working in that folder as a prompt, with the page's path, the element's selector and
its text.

Two halves:

- **The plugin** (this folder): every 2 seconds it reads `.scratch/preview-comments.jsonl` in the session's folder and
  submits the lines it hasn't sent yet. It remembers how far it got per folder, so a restart doesn't send them again.
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
land in that worktree's `.scratch/`.

## Check it

```
claude plugin validate .
claude plugin test .
```
