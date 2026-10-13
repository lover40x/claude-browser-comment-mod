import { appendFile, mkdir } from "node:fs/promises";

// Dev only: the comment overlay (app/dev-comments.tsx) posts here, and the comment-mode plugin reads the file and
// hands each new line to Claude. Gone outside `next dev`.
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  const { path, selector, text, comment } = await request.json().catch(() => ({}));
  if (typeof comment !== "string" || !comment.trim()) return Response.json({ error: { code: "bad_request", message: "Comment is empty." } }, { status: 400 });
  const line = { at: new Date().toISOString(), path: String(path ?? ""), selector: String(selector ?? ""), text: String(text ?? "").slice(0, 200), comment: comment.slice(0, 4000) };
  await mkdir(".scratch", { recursive: true });
  await appendFile(".scratch/preview-comments.jsonl", JSON.stringify(line) + "\n");
  return Response.json({ ok: true });
}
