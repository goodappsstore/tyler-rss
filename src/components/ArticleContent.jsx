import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { mediaSrc } from "../api";
import "./reader.css";

const FORBID_TAGS = [
  "script",
  "style",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "object",
  "embed",
  "link",
  "meta",
  "base",
];

DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (
    node.tagName === "IMG" && data.attrName === "src" &&
    /^tyler-media:\/\/localhost\/media\/(?:feed-icons|covers|articles)\/[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(data.attrValue)
  ) {
    data.forceKeepAttr = true;
  }
});

export function allowedEmbed(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    return (["www.youtube.com", "www.youtube-nocookie.com"].includes(url.hostname) && url.pathname.startsWith("/embed/")) ||
      (url.hostname === "player.vimeo.com" && url.pathname.startsWith("/video/"));
  } catch { return false; }
}

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "IFRAME") {
    if (!allowedEmbed(node.getAttribute("src"))) { node.remove(); return; }
    node.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
    node.setAttribute("referrerpolicy", "no-referrer");
    node.setAttribute("loading", "lazy");
    node.setAttribute("allow", "fullscreen; picture-in-picture");
    node.setAttribute("title", node.getAttribute("title") || "Embedded video");
  }
  if (node.tagName === "AUDIO" || node.tagName === "VIDEO") {
    node.setAttribute("controls", "");
    node.setAttribute("preload", "none");
    node.removeAttribute("autoplay");
  }
  if (node.tagName === "A") {
    const href = node.getAttribute("href");
    if (!href || /^\s*(javascript|data|vbscript):/i.test(href)) {
      node.removeAttribute("href");
      return;
    }
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }

  if (node.tagName === "IMG") {
    const src = node.getAttribute("src");
    if (src) node.setAttribute("src", mediaSrc(src));
    node.setAttribute("loading", "lazy");
    node.setAttribute("decoding", "async");
  }
});

function cleanHref(value) {
  if (!value) return "";
  return value.trim();
}

function findDestination(root, id) {
  if (!root || !id) return null;
  try {
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id;
    const match = root.querySelector(`#${escaped}`);
    if (match) return match;
  } catch {
    // Fall through to the id scan below for unusual ids.
  }
  return Array.from(root.querySelectorAll("[id]")).find(
    (element) => element.id === id
  ) || null;
}

export default function ArticleContent({
  html,
  onOpenExternal,
  findQuery = "",
  findIndex = 0,
  onFindCount,
  fontSize = 18,
  lineWidth = 700,
  fontFamily,
}) {
  const rootRef = useRef(null);

  const sanitized = useMemo(() => {
    if (!html || typeof html !== "string") return "";
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS,
      ADD_TAGS: ["iframe"],
      FORBID_ATTR: ["srcdoc", "formaction"],
      ADD_ATTR: ["target", "rel", "loading", "decoding"],
    });
  }, [html]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const images = Array.from(root.querySelectorAll("img"));
    const cleanup = [];

    root.querySelectorAll("table").forEach((table) => {
      if (table.parentElement?.classList.contains("reader-table-scroll")) return;
      const wrapper = document.createElement("div");
      wrapper.className = "reader-table-scroll";
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    });

    images.forEach((image) => {
      const markBroken = () => image.classList.add("is-broken");
      const clearBroken = () => image.classList.remove("is-broken");

      image.setAttribute("loading", "lazy");
      image.setAttribute("decoding", "async");
      image.addEventListener("error", markBroken);
      image.addEventListener("load", clearBroken);
      cleanup.push(() => {
        image.removeEventListener("error", markBroken);
        image.removeEventListener("load", clearBroken);
      });

      if (image.complete && image.naturalWidth === 0) markBroken();
    });

    return () => cleanup.forEach((fn) => fn());
  }, [sanitized]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) { onFindCount?.(0); return; }
    root.querySelectorAll("mark[data-reader-match]").forEach((mark) => mark.replaceWith(...mark.childNodes));
    root.normalize();
    if (!findQuery) { onFindCount?.(0); return; }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = "";
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest("audio,video,iframe")) continue;
      nodes.push({ node, start: text.length });
      text += node.textContent;
    }
    const pattern = new RegExp(findQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
    const matches = [];
    let match;
    while (matches.length < 1000 && (match = pattern.exec(text))) {
      matches.push({ start: match.index, end: match.index + match[0].length });
    }
    for (const { node, start } of nodes) {
      const value = node.textContent;
      const overlaps = matches.map((match, index) => ({ start: Math.max(0, match.start - start), end: Math.min(value.length, match.end - start), index }))
        .filter((match) => match.start < match.end);
      if (!overlaps.length) continue;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const match of overlaps) {
        fragment.append(document.createTextNode(value.slice(offset, match.start)));
        const mark = document.createElement("mark");
        mark.dataset.readerMatch = String(match.index);
        mark.textContent = value.slice(match.start, match.end);
        fragment.append(mark);
        offset = match.end;
      }
      fragment.append(document.createTextNode(value.slice(offset)));
      node.replaceWith(fragment);
    }
    onFindCount?.(matches.length);
  }, [sanitized, findQuery, onFindCount]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll("mark[data-reader-match]").forEach((mark) => {
      mark.classList.toggle("is-current", Number(mark.dataset.readerMatch) === findIndex);
    });
    root.querySelector(`mark[data-reader-match="${findIndex}"]`)?.scrollIntoView({ block: "center" });
  }, [sanitized, findQuery, findIndex]);

  const handleClick = (event) => {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;

    const anchor = target.closest("a");
    if (!anchor || !rootRef.current?.contains(anchor)) return;

    const href = cleanHref(anchor.getAttribute("href"));
    if (!href) return;

    if (href.startsWith("#")) {
      let id = "";
      try {
        id = decodeURIComponent(href.slice(1));
      } catch {
        id = href.slice(1);
      }
      const destination = findDestination(rootRef.current, id);
      if (destination) {
        event.preventDefault();
        destination.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      event.preventDefault();
      return;
    }

    event.preventDefault();
    if (/^\s*(javascript|data|vbscript):/i.test(href)) return;
    onOpenExternal?.(href);
  };

  const style = {
    "--reader-size": `${Number(fontSize) || 18}px`,
    "--reader-width": `${Number(lineWidth) || 700}px`,
    "--reader-font":
      fontFamily || 'var(--font-serif, "Newsreader Variable", Georgia, serif)',
  };

  if (!sanitized) {
    return (
      <div className="reader-prose reader-prose--empty" style={style}>
        <p>This story arrived without body text.</p>
        <p className="reader-prose-note">
          Use Open original above to read it at the source.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="reader-prose prose"
      style={style}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}
