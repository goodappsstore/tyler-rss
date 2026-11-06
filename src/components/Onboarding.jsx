import { useState } from "react";
import {
  AlertCircle,
  Check,
  Plus,
  Settings,
  Upload,
} from "lucide-react";
import { hostOf } from "../lib/format";
import { ONBOARDING_STARTERS } from "../lib/feedStarters";
import { errorMessage } from "../api";
import BrandMark from "./BrandMark";
import { Button, IconButton, Spinner } from "./ui";

export default function Onboarding({
  dataDir,
  onAddFeed,
  onAddFeeds,
  onBrowseFeeds,
  onOpenTransfer,
  onOpenSettings,
}) {
  const [url, setUrl] = useState("");
  const [busyUrl, setBusyUrl] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(new Set());

  function toggleStarter(starter) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(starter.url)) next.delete(starter.url);
      else next.add(starter.url);
      return next;
    });
  }

  async function addSelected() {
    if (!selected.size || busyUrl) return;
    setBusyUrl("batch");
    setError(null);
    try {
      const result = await onAddFeeds(ONBOARDING_STARTERS.filter((starter) => selected.has(starter.url)));
      if (result.failures.length) setError(result.failures.join("\n"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusyUrl(null);
    }
  }

  async function add(target) {
    const raw = String(target || "").trim();
    if (!raw || busyUrl) return;
    const value = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
      ? raw
      : `https://${raw}`;
    setBusyUrl(raw);
    setError(null);
    try {
      await onAddFeed(value);
      setUrl("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyUrl(null);
    }
  }

  function submit(event) {
    event.preventDefault();
    add(url);
  }

  return (
    <div className="onboarding">
      <div className="onboarding-inner">
        <div className="onboarding-topline">
          <span className="onboarding-kicker">
            <BrandMark size={17} />
            <span className="onboarding-brand">Tyler</span>
            <span className="onboarding-kicker-sep" aria-hidden="true">
              ·
            </span>
            A local-first RSS reader
          </span>
          <div className="onboarding-top-actions">
            <IconButton label="Settings" onClick={onOpenSettings}>
              <Settings size={16} />
            </IconButton>
          </div>
        </div>

        <section className="onboarding-hero">
          <h1>Welcome to Tyler.</h1>
          <p>
            One library for everything you follow. No account, no algorithm, no
            cloud. Fast to scan, made to read.
          </p>
        </section>

        <div className="onboarding-card">
          <form className="onboarding-form" onSubmit={submit}>
            <label htmlFor="onboarding-feed-url">Add your first feed</label>
            <div className="onboarding-input-row">
              <div className="onboarding-input-wrap">
                <span className="input-prefix" aria-hidden="true">
                  https://
                </span>
                <input
                  id="onboarding-feed-url"
                  type="text"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    setError(null);
                  }}
                  placeholder="a site or feed address"
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  disabled={!!busyUrl}
                />
              </div>
              <Button
                variant="primary"
                type="submit"
                loading={busyUrl === url.trim() && !!url.trim()}
                disabled={!url.trim() || !!busyUrl}
              >
                Add feed
              </Button>
            </div>
            <p className="onboarding-hint">
              Paste any site address. Tyler finds its RSS or Atom feed
              automatically.
            </p>
            {error && (
              <div className="onboarding-error" role="alert">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}
          </form>

          <div className="suggestion-divider">
            <span>Start with a publication</span>
          </div>

          <div className="suggestion-grid">
            {ONBOARDING_STARTERS.map((starter) => {
              const chosen = selected.has(starter.url);
              const disabled = !!busyUrl;
              return (
                <button
                  key={starter.url}
                  type="button"
                  className={`suggestion ${chosen ? "is-selected" : ""}`.trim()}
                  onClick={() => toggleStarter(starter)}
                  disabled={disabled}
                  title={`${chosen ? "Deselect" : "Select"} ${starter.name}`}
                  aria-pressed={chosen}
                >
                  <span className="suggestion-glyph" aria-hidden="true">
                    {chosen ? <Check size={13} /> : (
                      starter.name.charAt(0)
                    )}
                  </span>
                  <span className="suggestion-text">
                    <span className="suggestion-name">{starter.name}</span>
                    <span className="suggestion-host">{hostOf(starter.url)}</span>
                  </span>
                  <span className="suggestion-note">{starter.category}</span>
                  <span className="suggestion-add" aria-hidden="true">
                    {chosen ? <Check size={14} /> : <Plus size={14} />}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="onboarding-selection">
            <Button variant="primary" onClick={addSelected} disabled={!selected.size || !!busyUrl} loading={busyUrl === "batch"}>
              Add {selected.size || "selected"} {selected.size === 1 ? "feed" : "feeds"}
            </Button>
            <Button variant="ghost" onClick={onBrowseFeeds} disabled={!!busyUrl}>Browse all publications</Button>
          </div>

          <div className="onboarding-card-footer">
            <Button variant="default" size="sm" icon={Upload} onClick={onOpenTransfer}>
              Import OPML
            </Button>
            <span className="footer-note">
              Moving from another reader? Bring your subscriptions over.
            </span>
          </div>
        </div>

        <div className="onboarding-meta" title={dataDir}>
          <span className="meta-check" aria-hidden="true">
            <Check size={11} />
          </span>
          <span>Everything stays on this machine</span>
          {dataDir && (
            <>
              <span className="meta-sep" aria-hidden="true">
                ·
              </span>
              <span className="meta-path">{dataDir}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
