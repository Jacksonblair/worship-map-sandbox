// ILogger: { log(level, category, message, data?) }. level is one of
// "debug" | "info" | "warn" | "error". Every implementation below has
// that exact shape, so callers depend on the shape, not on any one of
// these -- swap freely, compose freely.
//
// Why this exists: the single biggest finding from the code review that
// preceded this file was that nothing in this codebase listened to
// MapLibre's own `error` event, so a large share of real failures
// (bad layer ids, validation errors, tile fetch failures) were
// completely invisible -- not even in devtools, since nobody using this
// sandbox opens devtools. A logger that can fan out to the page AND to
// a server-side file (see createRemoteLogger) removes the human from
// the diagnostic loop entirely: the next debugging session can just
// read a log file instead of transcribing a screen.

export const LOG_LEVELS = ["debug", "info", "warn", "error"];

function formatEntry(level, category, message, data) {
  const time = new Date().toISOString();
  const dataStr = data === undefined ? "" : ` ${safeStringify(data)}`;
  return `[${time}] ${level.toUpperCase()} ${category}: ${message}${dataStr}`;
}

function safeStringify(data) {
  try {
    return JSON.stringify(data);
  } catch (error) {
    return String(data);
  }
}

export function createConsoleLogger() {
  return {
    log(level, category, message, data) {
      const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      fn(formatEntry(level, category, message, data));
    },
  };
}

// Writes into a DOM element, capped and de-duplicated -- an unbounded
// per-frame error (e.g. from something inside a render() loop) would
// otherwise grow the DOM without bound, which was flagged explicitly as
// a real risk in review. Consecutive identical entries collapse into
// one line with a repeat count instead of one line per occurrence.
// minLevel defaults to "warn" -- this panel is styled as an error
// indicator (red text), and routine "info"/"debug" traffic (a toggle's
// own "reapply: 0 changes", "baseline captured", etc.) would otherwise
// flood it on every ordinary interaction, making genuine problems
// indistinguishable from normal operation. Full detail at every level
// still reaches the console and the remote/file log below -- this is
// the one sink that's deliberately filtered, because it's the one a
// person is expected to glance at and judge "is something wrong" from.
export function createPageLogger(elementId, { maxEntries = 200, minLevel = "warn" } = {}) {
  const entries = []; // { text, count }
  const minLevelIndex = LOG_LEVELS.indexOf(minLevel);
  function render() {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = entries
      .map((e) => (e.count > 1 ? `${e.text} (x${e.count})` : e.text))
      .join("\n");
  }
  return {
    log(level, category, message, data) {
      if (LOG_LEVELS.indexOf(level) < minLevelIndex) return;
      const text = formatEntry(level, category, message, data);
      const last = entries[entries.length - 1];
      if (last && last.text === text) {
        last.count += 1;
      } else {
        entries.push({ text, count: 1 });
        if (entries.length > maxEntries) entries.shift();
      }
      render();
    },
  };
}

// POSTs each entry to a server-side endpoint (see no_cache_server.py's
// /log handler) so a log survives page reloads/crashes and is
// diagnosable from the file system, not just from whatever's currently
// on screen. Fire-and-forget: a logging failure must never itself throw
// or recurse into more logging.
export function createRemoteLogger(url) {
  return {
    log(level, category, message, data) {
      const body = JSON.stringify({
        time: new Date().toISOString(),
        level,
        category,
        message,
        data,
      });
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(
        () => {},
      );
    },
  };
}

export function createCompositeLogger(loggers) {
  return {
    log(level, category, message, data) {
      for (const logger of loggers) logger.log(level, category, message, data);
    },
  };
}

// For tests -- captures entries in memory so assertions can inspect
// exactly what was logged, with no DOM/network/console involved.
export function createMemoryLogger() {
  const entries = [];
  return {
    entries,
    log(level, category, message, data) {
      entries.push({ level, category, message, data });
    },
  };
}

// Does nothing -- the null-object pattern, so callers that receive an
// optional logger never need an `if (logger)` check.
export function createNoopLogger() {
  return { log() {} };
}

// Catches whatever map.on("error", ...) can't -- a plain uncaught JS
// exception or an unhandled promise rejection anywhere on the page,
// not just inside MapLibre. Between this and the map error listener
// (wired separately in main.js, since it needs the map instance), the
// two together cover both halves of "something failed and nothing was
// watching for it," which was the throughline behind nearly every bug
// in this codebase's history.
export function installGlobalErrorLogging(logger) {
  window.addEventListener("error", (e) =>
    logger.log("error", "window", e.message, { filename: e.filename, lineno: e.lineno }),
  );
  window.addEventListener("unhandledrejection", (e) =>
    logger.log("error", "window", `unhandled rejection: ${e.reason}`),
  );
}
