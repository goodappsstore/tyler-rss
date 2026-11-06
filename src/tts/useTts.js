import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { api, errorMessage } from "../api";

const IDLE = { status: "idle", articleId: null, title: "", paused: false };

export default function useTts({ settings, article, selectedId, notify }) {
  const [playback, setPlayback] = useState(IDLE);
  const [model, setModel] = useState({ status: "idle", message: "" });
  const runtime = useRef({ worker: null, context: null, sources: new Set(), nextStart: 0, generating: false, finished: false, session: null, paused: false, generation: 0, requestNext: null });
  const preparations = useRef(new Map());
  const latest = useRef({ settings, article, selectedId, notify });
  latest.current = { settings, article, selectedId, notify };

  const stop = useCallback(() => {
    const state = runtime.current;
    state.generation += 1;
    const sessionId = state.session?.id;
    state.session = null;
    if (sessionId) api.stopTts(sessionId).catch(() => {});
    state.nextStart = 0;
    state.paused = false;
    state.generating = false;
    state.finished = false;
    state.requestNext = null;
    for (const source of state.sources) {
      source.onended = null;
      source.stop();
    }
    state.sources.clear();
    state.context?.close().catch(() => {});
    state.context = null;
    // Native cancellation stops inference; terminating the worker discards pending phonemization.
    state.worker?.terminate();
    state.worker = null;
    setPlayback(IDLE);
  }, []);

  const prepare = useCallback(async (voice = latest.current.settings?.tts_voice || "af_heart") => {
    const { settings: current } = latest.current;
    if (!current?.tts_enabled) return;
    setModel({ status: "loading", message: "Checking Kokoro files…" });
    try {
      let pending = preparations.current.get(voice);
      if (!pending) {
        pending = api.prepareTts(voice).finally(() => preparations.current.delete(voice));
        preparations.current.set(voice, pending);
      }
      await pending;
      if (latest.current.settings?.tts_enabled && (latest.current.settings.tts_voice || "af_heart") === voice) setModel({ status: "ready", message: "Downloaded · available offline" });
    } catch (error) {
      if (latest.current.settings?.tts_enabled && (latest.current.settings.tts_voice || "af_heart") === voice) setModel({ status: "error", message: errorMessage(error) });
      throw error;
    }
  }, []);

  useEffect(() => {
    if (settings?.tts_enabled) {
      prepare().catch(() => {});
    } else {
      stop();
      setModel({ status: "idle", message: "" });
    }
  }, [settings?.tts_enabled, settings?.tts_voice, prepare, stop]);

  useEffect(() => {
    let cancelled = false;
    let unlisten;
    listen("tts:download", ({ payload }) => {
      if (cancelled || !latest.current.settings?.tts_enabled) return;
      const percent = Math.min(100, Math.round(payload.received / payload.total * 100));
      setModel({ status: "loading", message: `Downloading ${payload.file.startsWith("voices/") ? "voice" : "Kokoro"}… ${percent}%` });
    }).then((cleanup) => { if (cancelled) cleanup(); else unlisten = cleanup; }).catch(() => {});
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    const session = runtime.current.session;
    if (session && !settings?.tts_keep_playing && session.articleId !== selectedId) stop();
  }, [selectedId, settings?.tts_keep_playing, stop]);

  useEffect(() => () => stop(), [stop]);

  const play = useCallback(async () => {
    const state = runtime.current;
    if (state.session) {
      state.paused = !state.paused;
      setPlayback((previous) => ({ ...previous, paused: state.paused }));
      try {
        if (state.paused) await state.context?.suspend();
        else { await state.context?.resume(); state.requestNext?.(); }
      } catch (error) {
        stop();
        latest.current.notify(errorMessage(error), "error");
      }
      return;
    }
    const { article: current, settings: preferences } = latest.current;
    if (!preferences?.tts_enabled || !current || current.id !== latest.current.selectedId) return;
    const body = current.content_text?.trim() || current.summary?.trim();
    if (!body) {
      latest.current.notify("This article has no text to read aloud. Try loading the full article.", "info");
      return;
    }
    const generation = ++state.generation;
    const sessionId = crypto.randomUUID();
    state.session = { id: sessionId, articleId: current.id, title: current.title || "Untitled article" };
    setPlayback({ ...state.session, status: "loading", paused: false });
    try {
      // Create and resume audio during the click so delayed inference can play in WebKit.
      state.context = new AudioContext();
      await state.context.resume();
      if (state.generation !== generation) return;
      if (state.paused) await state.context.suspend();
      await prepare(preferences.tts_voice || "af_heart");
      if (state.generation !== generation) return;
      await api.startTts(sessionId);
      if (state.generation !== generation) { api.stopTts(sessionId).catch(() => {}); return; }
      const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
      state.worker = worker;
      const requestNext = () => {
        if (!state.generating && !state.finished && !state.paused && state.sources.size < 2) {
          state.generating = true;
          worker.postMessage({ type: "next" });
        }
      };
      state.requestNext = requestNext;
      const schedule = (chunk) => {
        if (!chunk.samples.length) { requestNext(); return; }
        const buffer = state.context.createBuffer(1, chunk.samples.length, chunk.sampleRate);
        buffer.copyToChannel(chunk.samples, 0);
        const source = state.context.createBufferSource();
        source.buffer = buffer;
        source.connect(state.context.destination);
        source.onended = () => {
          state.sources.delete(source);
          if (state.finished && state.sources.size === 0) stop();
          else {
            if (state.sources.size === 0) setPlayback((previous) => ({ ...previous, status: "loading" }));
            requestNext();
          }
        };
        state.sources.add(source);
        // Schedule on the audio clock to avoid gaps between already generated segments.
        const start = Math.max(state.context.currentTime + 0.02, state.nextStart);
        state.nextStart = start + buffer.duration;
        source.start(start);
        setPlayback((previous) => ({ ...previous, status: "playing" }));
      };
      const fail = (message) => {
        if (state.generation !== generation) return;
        stop();
        latest.current.notify(`Could not read aloud: ${message}`, "error");
      };
      worker.onerror = (event) => { event.preventDefault(); fail(event.message || "Speech worker failed."); };
      worker.onmessage = async ({ data }) => {
        if (state.generation !== generation) return;
        if (data.type === "ready") worker.postMessage({ type: "start", text: `${current.title || ""}.\n\n${body}`, voice: preferences.tts_voice || "af_heart" });
        else if (data.type === "started") requestNext();
        else if (data.type === "tokens") {
          try {
            const samples = await api.synthesizeTts(sessionId, preferences.tts_voice || "af_heart", data.tokens);
            if (state.generation !== generation) return;
            state.generating = false;
            schedule({ samples, sampleRate: 24_000 });
            requestNext();
          } catch (error) { fail(errorMessage(error)); }
        } else if (data.type === "finished") {
          state.generating = false;
          state.finished = true;
          if (state.sources.size === 0) stop();
        } else if (data.type === "error") fail(data.message);
      };
      worker.postMessage({ type: "load", base: convertFileSrc("", "tyler-tts").replace(/\/$/, "") });
    } catch (error) {
      if (state.generation !== generation) return;
      stop();
      latest.current.notify(`Could not read aloud: ${errorMessage(error)}`, "error");
    }
  }, [prepare, stop]);

  return { playback, model, play, stop, prepare };
}
