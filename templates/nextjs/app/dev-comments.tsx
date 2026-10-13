"use client";

import { useEffect, useRef, useState } from "react";

// Dev only (app/layout.tsx mounts it under `next dev`): click any element, write a comment, and it lands in
// .scratch/preview-comments.jsonl through /api/dev/comments, where the comment-mode plugin hands it to Claude.

type Target = { el: Element; rect: DOMRect };

function selectorOf(el: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
    if (e.id) {
      parts.unshift(`#${CSS.escape(e.id)}`);
      break;
    }
    const classes = [...e.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
    const siblings = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e!.tagName) : [];
    const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(e) + 1})` : "";
    parts.unshift(e.tagName.toLowerCase() + classes + nth);
  }
  return parts.join(" > ");
}

const isOurs = (el: EventTarget | null) => el instanceof Element && !!el.closest("[data-dev-comments]");

export default function DevComments() {
  const [isOn, setIsOn] = useState(false);
  const [hover, setHover] = useState<DOMRect | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOn) return;
    const move = (e: MouseEvent) => {
      if (target || isOurs(e.target)) return;
      setHover(e.target instanceof Element ? e.target.getBoundingClientRect() : null);
    };
    const click = (e: MouseEvent) => {
      if (isOurs(e.target) || !(e.target instanceof Element)) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget({ el: e.target, rect: e.target.getBoundingClientRect() });
      setHover(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (target) setTarget(null);
      else setIsOn(false);
    };
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [isOn, target]);

  useEffect(() => box.current?.focus(), [target]);

  async function send() {
    if (!target || !draft.trim()) return;
    const { el } = target;
    const text = ((el as HTMLElement).innerText || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const res = await fetch("/api/dev/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: location.pathname + location.search, selector: selectorOf(el), text, comment: draft }),
    });
    setNote(res.ok ? "Sent to Claude" : "Not sent: " + res.status);
    setTimeout(() => setNote(""), 2500);
    if (res.ok) {
      setDraft("");
      setTarget(null);
    }
  }

  const outline = (r: DOMRect, color: string): React.CSSProperties => ({
    position: "fixed", left: r.left - 2, top: r.top - 2, width: r.width + 4, height: r.height + 4,
    border: `2px solid ${color}`, borderRadius: 4, pointerEvents: "none", zIndex: 99998,
  });
  const below = target && target.rect.bottom + 150 < innerHeight;

  return (
    <div data-dev-comments style={{ font: "13px system-ui, sans-serif" }}>
      {isOn && hover && <div style={outline(hover, "#f97316")} />}
      {target && <div style={outline(target.rect, "#2563eb")} />}
      {target && (
        <div
          style={{
            position: "fixed", zIndex: 99999, width: 300, padding: 8, background: "#fff", borderRadius: 8,
            boxShadow: "0 4px 20px rgba(0,0,0,.2)",
            left: Math.min(target.rect.left, innerWidth - 316),
            top: below ? target.rect.bottom + 8 : Math.max(8, target.rect.top - 140),
          }}
        >
          <textarea
            ref={box}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && send()}
            placeholder="Comment for Claude… (⌘↵ to send)"
            rows={3}
            style={{ width: "100%", boxSizing: "border-box", padding: 6, border: "1px solid #d4d4d8", borderRadius: 6, resize: "vertical", font: "inherit" }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 6 }}>
            <button onClick={() => setTarget(null)} style={{ padding: "4px 10px" }}>Cancel</button>
            <button onClick={send} disabled={!draft.trim()} style={{ padding: "4px 10px", background: "#111827", color: "#fff", borderRadius: 6 }}>Send</button>
          </div>
        </div>
      )}
      <button
        onClick={() => { setIsOn(!isOn); setTarget(null); setHover(null); }}
        style={{
          position: "fixed", right: 16, bottom: 16, zIndex: 99999, padding: "8px 14px", borderRadius: 999,
          background: isOn ? "#f97316" : "#111827", color: "#fff", boxShadow: "0 2px 10px rgba(0,0,0,.25)",
        }}
      >
        {note || (isOn ? "Commenting · Esc to stop" : "Comment")}
      </button>
    </div>
  );
}
