import { diffLines } from "./diff";

type MatchMap = number[]; // base index -> side index, -1 when not matched

function matchMap(base: string[], side: string[]): MatchMap {
  const map = new Array<number>(base.length).fill(-1);
  for (const op of diffLines(base.join("\n"), side.join("\n"))) {
    if (op.type === "equal" && op.aLine !== undefined && op.bLine !== undefined) {
      map[op.aLine - 1] = op.bLine - 1;
    }
  }
  return map;
}

export type MergeConflict = {
  baseStart: number;
  baseEnd: number;
  base: string[];
  ours: string[];
  theirs: string[];
};

export type MergeResult = {
  lines: string[];
  conflicts: MergeConflict[];
  clean: boolean;
};

/**
 * Anchor-based three-way merge. Anchors are base lines kept identically by both
 * sides; everything between two anchors is treated as one change region.
 * `theirs` (the new upstream version) never silently overwrites `ours`.
 */
export function merge3(base: string[], ours: string[], theirs: string[]): MergeResult {
  const mapOurs = matchMap(base, ours);
  const mapTheirs = matchMap(base, theirs);

  const anchors: { base: number; ours: number; theirs: number }[] = [];
  for (let i = 0; i < base.length; i++) {
    if (mapOurs[i] !== -1 && mapOurs[i] === mapTheirs[i]) anchors.push({ base: i, ours: mapOurs[i], theirs: mapTheirs[i] });
  }
  anchors.unshift({ base: -1, ours: -1, theirs: -1 });
  anchors.push({ base: base.length, ours: ours.length, theirs: theirs.length });

  const lines: string[] = [];
  const conflicts: MergeConflict[] = [];

  for (let a = 0; a < anchors.length - 1; a++) {
    const prev = anchors[a];
    const next = anchors[a + 1];
    const baseSeg = base.slice(prev.base + 1, next.base);
    const oursSeg = ours.slice(prev.ours + 1, next.ours);
    const theirsSeg = theirs.slice(prev.theirs + 1, next.theirs);

    const sameChange = oursSeg.join("\n") === theirsSeg.join("\n");
    const oursUntouched = oursSeg.join("\n") === baseSeg.join("\n");
    const theirsUntouched = theirsSeg.join("\n") === baseSeg.join("\n");

    if (sameChange || theirsUntouched) {
      lines.push(...oursSeg);
    } else if (oursUntouched) {
      lines.push(...theirsSeg);
    } else if (baseSeg.length === 0 && oursSeg.length === 0 && theirsSeg.length === 0) {
      // nothing to do between identical anchors
    } else {
      conflicts.push({
        baseStart: prev.base + 1,
        baseEnd: next.base,
        base: baseSeg,
        ours: oursSeg,
        theirs: theirsSeg,
      });
      lines.push(`<<<<<<< your mod`);
      lines.push(...oursSeg);
      lines.push("=======");
      lines.push(...theirsSeg);
      lines.push(`>>>>>>> upstream ${next.base}`);
    }

    // The anchor line itself is common to both sides and must survive the merge.
    if (next.base >= 0 && next.base < base.length) lines.push(base[next.base]);
  }

  return { lines, conflicts, clean: conflicts.length === 0 };
}

export function merge3Text(base: string, ours: string, theirs: string): MergeResult {
  const toLines = (s: string) => (s.length === 0 ? [] : s.split("\n"));
  const result = merge3(toLines(base), toLines(ours), toLines(theirs));
  return result;
}
