import type { ProjectFile } from "./project-analyze";

export type ConsoleEntry = { level: "log" | "warn" | "error" | "info"; text: string; at: string };

const CONSOLE_SHIM = `<script>
(function () {
  var send = function (level, args) {
    try {
      parent.postMessage({
        __vexPreview: true,
        level: level,
        text: Array.prototype.map.call(args, format).join(" ")
      }, "*");
    } catch (e) {}
  };
  function format(value) {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.name + ": " + value.message;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }
  ["log", "info", "warn", "error"].forEach(function (level) {
    var original = console[level] ? console[level].bind(console) : function () {};
    console[level] = function () { send(level, arguments); original.apply(console, arguments); };
  });
  window.addEventListener("error", function (event) {
    send("error", [event.message + " (" + (event.filename || "inline") + ":" + event.lineno + ":" + event.colno + ")"]);
  });
  window.addEventListener("unhandledrejection", function (event) {
    send("error", ["Unhandled promise rejection: " + format(event.reason)]);
  });
})();
</script>`;

function toDataUri(content: string, mime: string): string {
  return `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
}

/** Inlines local css/js references so the preview needs no network access. */
export function buildPreviewDocument(entry: string, files: ProjectFile[]): string {
  const entryFile = files.find((f) => f.path === entry) ?? files.find((f) => f.path.endsWith(".html"));
  if (!entryFile) {
    return `<!doctype html><html><body style="font-family:system-ui;background:#0b1120;color:#e7ecf7;padding:24px">
      <h2>No HTML entry file</h2><p>This project has no index.html, so the browser preview cannot render it.</p></body></html>`;
  }

  let html = entryFile.content;

  html = html.replace(/<link[^>]+href=["']([^"']+)["'][^>]*>/gi, (match, href: string) => {
    if (/^(https?:)?\/\//i.test(href) || href.startsWith("data:")) return match;
    const clean = href.replace(/^\.\//, "").split("?")[0].split("#")[0];
    const asset = files.find((f) => f.path === clean || f.path.endsWith(`/${clean}`));
    if (!asset) return match;
    return `<style data-from="${clean}">\n${asset.content}\n</style>`;
  });

  html = html.replace(/<script([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi, (match, _attrs, src: string) => {
    if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:")) return match;
    const clean = src.replace(/^\.\//, "").split("?")[0].split("#")[0];
    const asset = files.find((f) => f.path === clean || f.path.endsWith(`/${clean}`));
    if (!asset) return match;
    return `<script data-from="${clean}">\n${asset.content}\n</script>`;
  });

  // <img src="..."> and other url() references get data URIs when the file exists.
  html = html.replace(/src=["']([^"']+\.svg)["']/gi, (match, path: string) => {
    const clean = path.replace(/^\.\//, "");
    const asset = files.find((f) => f.path === clean || f.path.endsWith(`/${clean}`));
    return asset ? `src="${toDataUri(asset.content, "image/svg+xml")}"` : match;
  });

  return html.replace(/<head([^>]*)>/i, `<head$1>${CONSOLE_SHIM}`);
}

export const SANDBOX_ATTRIBUTES = "allow-scripts allow-modals allow-pointer-lock";

/** Locked-down viewer used for the "static/HTML" runtime target. */
export function previewIframeProps(): Record<string, string> {
  return { sandbox: SANDBOX_ATTRIBUTES, referrerpolicy: "no-referrer" };
}
