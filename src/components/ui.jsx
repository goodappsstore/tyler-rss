import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, LoaderCircle } from "lucide-react";

/**
 * Small, dependency-free primitives used by the shell. Reader and dialog
 * components own their own visuals, so nothing here is exported for them.
 */

export function Spinner({ size = 14, className = "", label = "Loading" }) {
  return (
    <LoaderCircle
      size={size}
      className={`spinner ${className}`.trim()}
      aria-label={label}
      role="img"
    />
  );
}

export function Button({
  children,
  variant = "default",
  size = "md",
  icon: Icon,
  loading = false,
  className = "",
  type = "button",
  disabled,
  ...props
}) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <Spinner size={size === "sm" ? 13 : 15} />
      ) : Icon ? (
        <Icon size={size === "sm" ? 14 : 15} strokeWidth={1.9} />
      ) : null}
      {children != null && <span>{children}</span>}
    </button>
  );
}

export function IconButton({
  children,
  label,
  size = "md",
  variant = "ghost",
  className = "",
  active = false,
  ...props
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-active={active ? "true" : undefined}
      className={`icon-btn icon-btn-${size} icon-btn-${variant} ${
        active ? "is-active" : ""
      } ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = "neutral", className = "" }) {
  return (
    <span className={`badge badge-${tone} ${className}`.trim()}>{children}</span>
  );
}

export function Kbd({ children, className = "" }) {
  return <kbd className={`kbd ${className}`.trim()}>{children}</kbd>;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  ariaLabel = "Filter",
  className = "",
}) {
  return (
    <div
      className={`segmented ${className}`.trim()}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`segmented-item ${active ? "is-active" : ""}`}
            onClick={() => onChange?.(option.value)}
            title={option.title}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Select({ value, onChange, options, label, className = "", ...props }) {
  return (
    <label className={`select ${className}`.trim()}>
      {label && <span className="sr-only">{label}</span>}
      <select
        className="select-input"
        value={value}
        onChange={onChange}
        aria-label={label}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="select-chevron" aria-hidden="true" />
    </label>
  );
}

/**
 * Popover menu with outside-click and Escape handling.
 * Render the trigger through a function so callers can style it freely.
 */
export function Menu({ label, trigger, items, align = "end", className = "" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  function choose(item) {
    if (item.disabled) return;
    setOpen(false);
    item.onSelect?.();
  }

  return (
    <div className={`menu ${className}`.trim()} ref={rootRef}>
      {trigger({ open, toggle: () => setOpen((value) => !value) })}
      {open && (
        <div
          className={`menu-panel menu-panel-${align}`}
          role="menu"
          aria-label={label}
        >
          {items.map((item, index) =>
            item.separator ? (
              <div
                className="menu-separator"
                key={`sep-${index}`}
                role="separator"
              />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitemradio"
                aria-checked={!!item.active}
                className={`menu-item ${item.active ? "is-active" : ""}`}
                onClick={() => choose(item)}
                disabled={item.disabled}
              >
                {item.icon ? (
                  <item.icon size={14} strokeWidth={1.8} aria-hidden="true" />
                ) : (
                  <span className="menu-icon-spacer" />
                )}
                <span className="menu-item-label">{item.label}</span>
                {item.active && (
                  <Check size={13} className="menu-check" aria-hidden="true" />
                )}
                {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  eyebrow,
  title,
  body,
  action,
  secondaryAction,
  compact = false,
  className = "",
}) {
  return (
    <div className={`empty-state ${compact ? "is-compact" : ""} ${className}`.trim()}>
      {Icon && (
        <div className="empty-icon" aria-hidden="true">
          <Icon size={compact ? 18 : 22} strokeWidth={1.6} />
        </div>
      )}
      {eyebrow && <div className="empty-eyebrow">{eyebrow}</div>}
      <h2 className="empty-title">{title}</h2>
      {body && <p className="empty-body">{body}</p>}
      {(action || secondaryAction) && (
        <div className="empty-actions">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

/**
 * Feed icon with a deterministic initial fallback. Handles remote icons and
 * tyler-media:// URLs alike; the fallback keeps broken images from flashing.
 */
export function FeedIcon({ title = "", iconUrl = null, size = 18, className = "" }) {
  const [failed, setFailed] = useState(false);
  const letter = (title || "?").trim().charAt(0).toUpperCase() || "?";
  const dimension = { width: size, height: size };

  useEffect(() => {
    setFailed(false);
  }, [iconUrl]);

  if (iconUrl && !failed) {
    return (
      <span
        className={`feed-icon ${className}`.trim()}
        style={dimension}
        aria-hidden="true"
      >
        <img
          src={iconUrl}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={`feed-icon feed-icon-fallback ${className}`.trim()}
      style={{ ...dimension, fontSize: Math.max(8, Math.round(size * 0.46)) }}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}
