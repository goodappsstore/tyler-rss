import { useEffect, useRef } from "react";
import {
  BookOpen,
  Command,
  Keyboard,
  Move,
  X,
} from "lucide-react";
import "./reader.css";

function modKey() {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || "")
    ? "⌘"
    : "Ctrl";
}

function Kbd({ keys }) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <span className="shortcuts-keys" aria-label={list.join(" plus ")}>
      {list.map((key, index) => (
        <kbd key={`${key}-${index}`}>{key}</kbd>
      ))}
    </span>
  );
}

function TrapTab(event, container) {
  if (event.key !== "Tab" || !container) return;
  const focusable = Array.from(
    container.querySelectorAll(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => element.offsetParent !== null);

  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export default function ShortcutsSheet({ open, onClose }) {
  const sheetRef = useRef(null);
  const closeRef = useRef(null);
  const restoreRef = useRef(null);
  const closeHandlerRef = useRef(onClose);
  const mod = modKey();

  useEffect(() => {
    closeHandlerRef.current = onClose;
  }, [onClose]);

  const groups = [
    {
      id: "navigation",
      title: "Navigation",
      caption: "Move through the library.",
      icon: Move,
      items: [
        { keys: ["↓"], label: "Next article", note: "Down arrow moves down the list" },
        { keys: ["↑"], label: "Previous article", note: "Up arrow moves up the list" },
        { keys: ["/"], label: "Search", note: "Focus the search field" },
        {
          keys: [mod, "K"],
          label: "Command palette",
          note: "Search stories or run a command",
        },
        { keys: ["Ctrl", "N"], label: "Next palette result", note: "While the command palette is open" },
        { keys: ["Ctrl", "P"], label: "Previous palette result", note: "While the command palette is open" },
      ],
    },
    {
      id: "reading",
      title: "Reading",
      caption: "Change the story in front of you.",
      icon: BookOpen,
      items: [
        { keys: [mod, "F"], label: "Find in article", note: "Enter moves between matches" },
        { keys: [mod, "P"], label: "Print / Save PDF", note: "Print the current article" },
        { keys: ["M"], label: "Toggle read", note: "Mark read or unread" },
        { keys: ["S"], label: "Star article", note: "Add or remove a star" },
        { keys: ["U"], label: "Mark unread", note: "Return it to the queue" },
        { keys: [mod, "+"], label: "Increase font size", note: "Reader text, up to 24 px" },
        { keys: [mod, "−"], label: "Decrease font size", note: "Reader text, down to 14 px" },
      ],
    },
    {
      id: "app",
      title: "App",
      caption: "Keep the whole reader in reach.",
      icon: Command,
      items: [
        { keys: ["R"], label: "Refresh feeds", note: "Fetch new stories" },
        { keys: ["?"], label: "Keyboard shortcuts", note: "Open this sheet" },
        { keys: ["Esc"], label: "Close overlay", note: "Palette, dialog, or reader" },
      ],
    },
  ];

  useEffect(() => {
    if (!open) return undefined;

    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 20);

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeHandlerRef.current?.();
        return;
      }
      TrapTab(event, sheetRef.current);
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown, true);
      restoreRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="shortcuts-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={sheetRef}
        className="shortcuts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <header className="shortcuts-head">
          <div className="shortcuts-heading">
            <span className="shortcuts-mark" aria-hidden="true">
              <Keyboard size={19} strokeWidth={1.8} />
            </span>
            <div>
              <p className="shortcuts-eyebrow">Keyboard</p>
              <h2 id="shortcuts-title" className="shortcuts-title">
                Every key, in one place.
              </h2>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="shortcuts-close"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >
            <X size={17} />
          </button>
        </header>

        <p className="shortcuts-intro">
          Shortcuts work in the article list and reader. They pause while you
          type in a field.
        </p>

        <div className="shortcuts-grid">
          {groups.map((group) => {
            const Icon = group.icon;
            return (
              <section className="shortcuts-group" key={group.id}>
                <div className="shortcuts-group-head">
                  <span className="shortcuts-group-icon" aria-hidden="true">
                    <Icon size={14} strokeWidth={1.9} />
                  </span>
                  <div>
                    <h3>{group.title}</h3>
                    <p>{group.caption}</p>
                  </div>
                </div>

                <div className="shortcuts-list">
                  {group.items.map((item) => (
                    <div className="shortcuts-row" key={`${group.id}-${item.label}`}>
                      <span className="shortcuts-row-copy">
                        <strong>{item.label}</strong>
                        <small>{item.note}</small>
                      </span>
                      <Kbd keys={item.keys} />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <footer className="shortcuts-foot">
          <span>
            Press <kbd>Esc</kbd> to close
          </span>
          <button type="button" className="shortcuts-done" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
