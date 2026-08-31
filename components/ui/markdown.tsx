"use client";

// The notes in every module are written as light markdown — bold, italics,
// bullets, links — so the prose stays readable in source. This renders exactly
// that subset and nothing else, so a value interpolated into a note can never
// inject markup.

import type { ReactNode } from "react";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Bold, italic and links, applied to already-escaped text. */
function inlineHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

/** Paragraphs and one level of bullets. */
export function markdownToHtml(text: string): string {
  const lines = text.trim().split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      out.push(`<p>${inlineHtml(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      out.push(`<ul>${bullets.map((b) => `<li>${inlineHtml(b)}</li>`).join("")}</ul>`);
      bullets = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushBullets();
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      bullets.push(line.slice(2));
    } else if (bullets.length) {
      // A wrapped continuation of the bullet above rather than a new paragraph.
      bullets[bullets.length - 1] += ` ${line}`;
    } else {
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushBullets();
  return out.join("");
}

export function Markdown({ text, className }: { text: string; className?: string }): ReactNode {
  return <div className={className} dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }} />;
}
