import DOMPurify from "dompurify";
import { marked } from "marked";

const TRUSTED_EMBED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "tiktok.com",
  "www.tiktok.com",
]);

function isTrustedEmbedSrc(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && TRUSTED_EMBED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "IFRAME") {
    const src = node.getAttribute("src") ?? "";
    if (!isTrustedEmbedSrc(src)) {
      node.parentNode?.removeChild(node);
    } else {
      // Restrict what the trusted iframe can do
      node.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-presentation allow-popups",
      );
    }
  }
});

export function renderMarkdown(raw: string): string {
  const html = marked.parse(raw, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: [
      "allow",
      "allowfullscreen",
      "frameborder",
      "scrolling",
      "loading",
      "target",
      "rel",
      "sandbox",
    ],
    FORCE_BODY: true,
    ALLOW_DATA_ATTR: false,
  });
}
