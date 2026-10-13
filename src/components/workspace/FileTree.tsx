"use client";

import { useMemo, useState } from "react";

export type TreeFile = { path: string; dirty?: boolean };

function buildTree(paths: string[]) {
  const root: { name: string; children: Map<string, NodeType> } = { name: "", children: new Map() };
  type NodeType = { name: string; path: string; children: Map<string, NodeType>; file: boolean };

  const ensure = (parts: string[]): NodeType => {
    let node: NodeType = root as unknown as NodeType;
    const walked: string[] = [];
    for (const part of parts) {
      walked.push(part);
      const current = node as unknown as { children: Map<string, NodeType>; path: string };
      let next = current.children.get(part);
      if (!next) {
        next = { name: part, path: walked.join("/"), children: new Map(), file: false };
        current.children.set(part, next);
      }
      node = next;
    }
    return node;
  };

  for (const path of paths) {
    const parts = path.split("/");
    const node = ensure(parts);
    node.file = true;
  }
  return root;
}

export function FileTree({
  files,
  activePath,
  onOpen,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  filter,
  onFilterChange,
}: {
  files: TreeFile[];
  activePath: string | null;
  onOpen: (path: string) => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const filtered = useMemo(
    () => (filter.trim() ? files.filter((f) => f.path.toLowerCase().includes(filter.trim().toLowerCase())) : files),
    [files, filter],
  );
  const tree = useMemo(() => buildTree(filtered.map((f) => f.path)), [filtered]);

  const renderNodes = (node: ReturnType<typeof buildTree>, depth: number) => {
    const folders = [...node.children.values()].filter((child) => !child.file || child.children.size > 0);
    const leaves = [...node.children.values()].filter((child) => child.file && child.children.size === 0);
    const rows: React.ReactNode[] = [];

    for (const folder of folders) {
      const isCollapsed = collapsed.has(folder.path);
      rows.push(
        <div key={`dir-${folder.path}`} style={{ paddingLeft: depth * 12 }}>
          <button
            type="button"
            className="tree-row"
            aria-expanded={!isCollapsed}
            onClick={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(folder.path)) next.delete(folder.path);
                else next.add(folder.path);
                return next;
              })
            }
          >
            <span aria-hidden>{isCollapsed ? "▸" : "▾"}</span>
            <span>{folder.name}</span>
          </button>
          {!isCollapsed ? <div>{renderNodes({ name: folder.name, children: folder.children }, depth + 1)}</div> : null}
        </div>,
      );
    }

    for (const leaf of leaves) {
      const meta = files.find((f) => f.path === leaf.path);
      rows.push(
        <div key={`file-${leaf.path}`} style={{ paddingLeft: depth * 12 + 12 }}>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="tree-row flex-1"
              data-active={activePath === leaf.path}
              data-dirty={meta?.dirty ?? false}
              onClick={() => onOpen(leaf.path)}
            >
              <span aria-hidden>·</span>
              <span className="truncate">{leaf.name}</span>
              {meta?.dirty ? <span aria-hidden>●</span> : null}
            </button>
            <button type="button" className="btn btn-sm" title={`Rename ${leaf.path}`} onClick={() => onRename(leaf.path)} aria-label={`Rename ${leaf.path}`}>
              ✎
            </button>
            <button type="button" className="btn btn-sm" title={`Delete ${leaf.path}`} onClick={() => onDelete(leaf.path)} aria-label={`Delete ${leaf.path}`}>
              ✕
            </button>
          </div>
        </div>,
      );
    }

    return <>{rows}</>;
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex gap-1">
        <button type="button" className="btn btn-sm flex-1" onClick={onCreateFile as unknown as () => void} title="New file">
          + File
        </button>
        <button type="button" className="btn btn-sm flex-1" onClick={onCreateFolder as unknown as () => void} title="New folder">
          + Folder
        </button>
      </div>
      <input className="input" placeholder="Filter files…" aria-label="Filter files" value={filter} onChange={(event) => onFilterChange(event.target.value)} />
      <div className="scroll-y flex-1">
        {filtered.length === 0 ? <p className="muted p-2 text-xs">No files match the filter.</p> : renderNodes(tree, 0)}
      </div>
    </div>
  );
}
