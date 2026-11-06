import { Archive, ArchiveRestore, Download, FileText, Loader2, Printer, Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import DOMPurify from "dompurify";
import { api, errorMessage } from "../api";
import { useToast } from "../store";

export async function printArticle(push) {
  try {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) await api.printArticle();
    else window.print();
  }
  catch (error) { push(errorMessage(error), "error"); }
}

export default function ReaderTools({ article, onToggleArchive, onLoadFullArticle, loadingFullArticle,
  findOpen, onFindOpen, findQuery, onFindQuery, findCount, findIndex, onFindStep, inputRef }) {
  const { push } = useToast();
  async function exportMarkdown() {
    try {
      const filename = (article.title || "Article").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").slice(0, 120);
      const path = await save({ defaultPath: `${filename}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (!path) return;
      const { default: TurndownService } = await import("turndown");
      const converter = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
      const clean = DOMPurify.sanitize(article.content_html || "", { USE_PROFILES: { html: true } });
      const title = converter.turndown(`<h1>${DOMPurify.sanitize(article.title || "Article", { ALLOWED_TAGS: [] })}</h1>`);
      const metadata = [article.author, article.published_at, article.url].filter(Boolean).join(" · ");
      const markdown = `${title}\n\n${metadata}\n\n${converter.turndown(clean) || article.content_text || article.summary || ""}\n`;
      await api.exportArticleMarkdown(path, markdown);
      push("Article exported as Markdown.", "success");
    } catch (error) { push(errorMessage(error), "error"); }
  }
  return (
    <div className="reader-tools">
      <div className="reader-tools-actions">
        <button className="reader-action" type="button" disabled={!article.url || loadingFullArticle}
          onClick={() => onLoadFullArticle?.(article)} title="Fetch and save the full article">
          {loadingFullArticle ? <Loader2 size={15} className="reader-spin" /> : <FileText size={15} />}
          {loadingFullArticle ? "Loading full article…" : article.full_content_loaded ? "Reload full article" : "Load full article"}
        </button>
        <button className="reader-action" type="button" onClick={() => onToggleArchive?.(article)}>
          {article.is_archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
          {article.is_archived ? "Restore" : "Archive"}
        </button>
        <button className="reader-action" type="button" onClick={exportMarkdown} title="Export article as Markdown"><Download size={15} />Markdown</button>
        <button className="reader-action" type="button" onClick={() => printArticle(push)} title="Print article or save as PDF"><Printer size={15} />Print / PDF</button>
        <button className="reader-action" type="button" onClick={() => onFindOpen(!findOpen)} title="Find in article (⌘/Ctrl+F)" aria-expanded={findOpen}><Search size={15} />Find</button>
      </div>
      {findOpen && <div className="reader-find" role="search" aria-label="Find in article">
        <input ref={inputRef} value={findQuery} onChange={(event) => onFindQuery(event.target.value)}
          aria-label="Find text in article" placeholder="Find in article…" onKeyDown={(event) => {
            if (event.key === "Escape") { event.stopPropagation(); onFindOpen(false); }
            if (event.key === "Enter") { event.preventDefault(); onFindStep(event.shiftKey ? -1 : 1); }
          }} />
        <span role="status">{findQuery ? `${findCount ? findIndex + 1 : 0} / ${findCount}` : ""}</span>
        <button className="reader-action" type="button" aria-label="Previous match" disabled={!findCount} onClick={() => onFindStep(-1)}><ChevronUp size={15} /></button>
        <button className="reader-action" type="button" aria-label="Next match" disabled={!findCount} onClick={() => onFindStep(1)}><ChevronDown size={15} /></button>
        <button className="reader-action" type="button" aria-label="Close find" onClick={() => onFindOpen(false)}><X size={15} /></button>
      </div>}
    </div>
  );
}

export function ArticleEnclosures({ enclosures = [] }) {
  const valid = enclosures.filter((item) => /^https?:\/\//i.test(item.url) && /^(audio|video)\//.test(item.mime));
  if (!valid.length) return null;
  return <section className="reader-enclosures" aria-label="Article media">
    {valid.map((item, index) => <div key={item.url}>
      <p>{item.mime.startsWith("audio/") ? "Listen" : "Watch"}{valid.length > 1 ? ` · ${index + 1}` : ""}</p>
      {item.mime.startsWith("audio/")
        ? <audio controls preload="none" src={item.url} aria-label="Podcast or audio enclosure" />
        : <video controls preload="none" src={item.url} aria-label="Video enclosure" />}
      <a href={item.url} onClick={(event) => { event.preventDefault(); api.openArticleLink(item.url).catch(() => {}); }}>Open media at source</a>
    </div>)}
  </section>;
}
