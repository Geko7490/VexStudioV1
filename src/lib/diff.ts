export type DiffOp = { type: "equal" | "add" | "remove"; text: string; aLine?: number; bLine?: number };
export type DiffHunk = { header: string; ops: DiffOp[] };
export type DiffStat = { added: number; removed: number; changed: boolean };

const MAX_DIFF_LINES = 6000;

/** Longest-common-subsequence line diff with a hard guard for huge inputs. */
export function diffLines(a: string, b: string): DiffOp[] {
  const aLines = a.length === 0 ? [] : a.split("\n");
  const bLines = b.length === 0 ? [] : b.split("\n");

  if (aLines.length > MAX_DIFF_LINES || bLines.length > MAX_DIFF_LINES) {
    // Fall back to a coarse replace so the UI never freezes on huge files.
    const ops: DiffOp[] = [];
    aLines.slice(0, 200).forEach((text, i) => ops.push({ type: "remove", text, aLine: i + 1 }));
    bLines.slice(0, 200).forEach((text, i) => ops.push({ type: "add", text, bLine: i + 1 }));
    return ops;
  }

  const n = aLines.length;
  const m = bLines.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      ops.push({ type: "equal", text: aLines[i], aLine: i + 1, bLine: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "remove", text: aLines[i], aLine: i + 1 });
      i++;
    } else {
      ops.push({ type: "add", text: bLines[j], bLine: j + 1 });
      j++;
    }
  }
  while (i < n) ops.push({ type: "remove", text: aLines[i], aLine: ++i });
  while (j < m) ops.push({ type: "add", text: bLines[j], bLine: ++j });
  return ops;
}

export function diffStat(a: string, b: string): DiffStat {
  let added = 0;
  let removed = 0;
  for (const op of diffLines(a, b)) {
    if (op.type === "add") added++;
    if (op.type === "remove") removed++;
  }
  return { added, removed, changed: added + removed > 0 };
}

/** Group diff ops into unified hunks with `context` lines of surrounding code. */
export function unifiedDiff(a: string, b: string, context = 3): DiffHunk[] {
  const ops = diffLines(a, b);
  const marks = ops.map((op, idx) => (op.type === "equal" ? -1 : idx));
  const changed = marks.filter((idx) => idx >= 0);
  if (changed.length === 0) return [];

  const ranges: [number, number][] = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(ops.length - 1, changed[0] + context);
  for (const idx of changed.slice(1)) {
    if (idx - context <= end + 1) {
      end = Math.min(ops.length - 1, idx + context);
    } else {
      ranges.push([start, end]);
      start = Math.max(0, idx - context);
      end = Math.min(ops.length - 1, idx + context);
    }
  }
  ranges.push([start, end]);

  return ranges.map(([from, to]) => {
    const slice = ops.slice(from, to + 1);
    const aStart = slice.find((o) => o.aLine !== undefined)?.aLine ?? 0;
    const bStart = slice.find((o) => o.bLine !== undefined)?.bLine ?? 0;
    const aCount = slice.filter((o) => o.type !== "add").length;
    const bCount = slice.filter((o) => o.type !== "remove").length;
    return {
      header: `@@ -${aStart},${aCount} +${bStart},${bCount} @@`,
      ops: slice,
    };
  });
}

/** Extracts fenced code blocks with an optional `path=` hint from a model answer. */
export type ProposedChange = {
  path: string;
  content: string;
  languageHint: string | null;
};

export function parseProposedChanges(answer: string): ProposedChange[] {
  const changes: ProposedChange[] = [];
  const fence = /```([a-zA-Z0-9+#-]*)[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(answer)) !== null) {
    const info = match[1] || "";
    const body = match[2].replace(/\n$/, "");
    const pathHint = match[0].match(/(?:path|file)\s*[:=]\s*([^\s*`]+)/i)?.[1];
    const firstComment = body.match(/^\s*(?:\/\/|#|<!--)\s*([\w./-]+\.[a-zA-Z0-9]{1,5})\s*(?:-->)?$/);
    const path = pathHint ?? firstComment?.[1] ?? null;
    changes.push({ path: path ?? "", content: body, languageHint: info || null });
  }
  return changes;
}
