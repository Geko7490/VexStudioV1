import { db } from "@/db";
import { projectFiles, projectVersions, projects } from "@/db/schema";
import { buildManifest, runStaticChecks, type ProjectFile } from "@/lib/project-analyze";
import { eq, sql } from "drizzle-orm";
import { logEvent } from "@/lib/log";

const ORBIT_FILES: ProjectFile[] = [
  {
    path: "index.html",
    content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vex Orbit</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <main class="stage">
    <header>
      <h1>Vex Orbit</h1>
      <p>Tap, click or press <kbd>Space</kbd> to reverse the orbit. Collect gems, avoid debris.</p>
    </header>
    <canvas id="game" width="480" height="480" aria-label="Vex Orbit game canvas"></canvas>
    <section class="hud">
      <span id="score">Score 0</span>
      <span id="best">Best 0</span>
      <button id="restart" type="button">Restart</button>
    </section>
  </main>
  <script src="game.js"></script>
</body>
</html>
`,
  },
  {
    path: "styles.css",
    content: `:root {
  color-scheme: dark;
  --bg: #0b1020;
  --panel: #141b31;
  --accent: #6ee7ff;
  --text: #e7ecf7;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 20%, #16224a, var(--bg) 70%);
  color: var(--text);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.stage { width: min(560px, 94vw); text-align: center; }
h1 { margin: 0 0 4px; font-size: clamp(22px, 5vw, 32px); letter-spacing: 0.08em; text-transform: uppercase; }
header p { margin: 0 0 16px; color: #9fb0d0; font-size: 14px; }
kbd { background: var(--panel); border: 1px solid #2b3a5c; border-radius: 4px; padding: 1px 6px; }
canvas {
  width: 100%;
  height: auto;
  aspect-ratio: 1 / 1;
  background: #080d1c;
  border: 1px solid #26314f;
  border-radius: 14px;
  touch-action: none;
}
.hud {
  display: flex;
  gap: 12px;
  justify-content: center;
  align-items: center;
  margin-top: 12px;
  font-variant-numeric: tabular-nums;
}
button {
  background: var(--panel);
  color: var(--text);
  border: 1px solid #2f3d61;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
}
button:focus-visible { outline: 2px solid var(--accent); }
`,
  },
  {
    path: "game.js",
    content: `"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const restartButton = document.getElementById("restart");

const SIZE = canvas.width;
const CENTER = SIZE / 2;
const ORBIT_MIN = 90;
const ORBIT_MAX = 190;

let angle = 0;
let direction = 1;
let radius = 140;
let score = 0;
let best = Number(localStorage.getItem("vex-orbit-best") || 0);
let gems = [];
let debris = [];
let running = true;
let lastFrame = performance.now();

bestEl.textContent = "Best " + best;

function reset() {
  angle = -Math.PI / 2;
  direction = 1;
  radius = 140;
  score = 0;
  gems = [];
  debris = [];
  running = true;
  for (let i = 0; i < 3; i += 1) spawnGem();
  for (let i = 0; i < 2; i += 1) spawnDebris();
  updateScore();
}

function spawnGem() {
  const orbit = ORBIT_MIN + Math.random() * (ORBIT_MAX - ORBIT_MIN);
  gems.push({ orbit, angle: Math.random() * Math.PI * 2, taken: false });
}

function spawnDebris() {
  const orbit = ORBIT_MIN + Math.random() * (ORBIT_MAX - ORBIT_MIN);
  const speed = 0.35 + Math.random() * 0.5;
  debris.push({ orbit, angle: Math.random() * Math.PI * 2, speed, spin: Math.random() > 0.5 ? 1 : -1 });
}

function updateScore() {
  scoreEl.textContent = "Score " + score;
}

function reverse() {
  if (!running) {
    reset();
    return;
  }
  direction *= -1;
  score += 1;
  updateScore();
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function update(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (running) {
    angle += direction * dt * 1.9;
    for (const gem of gems) {
      const px = CENTER + Math.cos(angle) * radius;
      const py = CENTER + Math.sin(angle) * radius;
      const gx = CENTER + Math.cos(gem.angle) * gem.orbit;
      const gy = CENTER + Math.sin(gem.angle) * gem.orbit;
      if (!gem.taken && distance(px, py, gx, gy) < 18) {
        gem.taken = true;
        score += 5;
        updateScore();
        spawnGem();
      }
    }
    for (const rock of debris) {
      rock.angle += rock.speed * rock.spin * dt;
      const px = CENTER + Math.cos(angle) * radius;
      const py = CENTER + Math.sin(angle) * radius;
      const rx = CENTER + Math.cos(rock.angle) * rock.orbit;
      const ry = CENTER + Math.sin(rock.angle) * rock.orbit;
      if (distance(px, py, rx, ry) < 16) {
        running = false;
        if (score > best) {
          best = score;
          localStorage.setItem("vex-orbit-best", String(best));
          bestEl.textContent = "Best " + best;
        }
      }
    }
  }

  draw();
  requestAnimationFrame(update);
}

function draw() {
  ctx.clearRect(0, 0, SIZE, SIZE);

  ctx.save();
  ctx.fillStyle = "#1d2a4d";
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#3a4d80";
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = "rgba(110, 231, 255, 0.15)";
  for (let r = ORBIT_MIN; r <= ORBIT_MAX; r += 25) {
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "#ffd166";
  for (const gem of gems) {
    if (gem.taken) continue;
    const gx = CENTER + Math.cos(gem.angle) * gem.orbit;
    const gy = CENTER + Math.sin(gem.angle) * gem.orbit;
    ctx.beginPath();
    ctx.arc(gx, gy, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#ef476f";
  for (const rock of debris) {
    const rx = CENTER + Math.cos(rock.angle) * rock.orbit;
    const ry = CENTER + Math.sin(rock.angle) * rock.orbit;
    ctx.beginPath();
    ctx.arc(rx, ry, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  const px = CENTER + Math.cos(angle) * radius;
  const py = CENTER + Math.sin(angle) * radius;
  ctx.fillStyle = running ? "#6ee7ff" : "#94a3b8";
  ctx.beginPath();
  ctx.arc(px, py, 11, 0, Math.PI * 2);
  ctx.fill();

  if (!running) {
    ctx.fillStyle = "rgba(8, 13, 28, 0.72)";
    ctx.fillRect(0, CENTER - 60, SIZE, 120);
    ctx.fillStyle = "#e7ecf7";
    ctx.font = "600 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Run ended", CENTER, CENTER - 6);
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText("Tap, click or press Space to restart", CENTER, CENTER + 22);
  }
}

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    reverse();
  }
});
canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  reverse();
});
restartButton.addEventListener("click", reset);

reset();
requestAnimationFrame(update);
`,
  },
  {
    path: "README.md",
    content: `# Vex Orbit

A dependency-free HTML/CSS/JS arcade toy used as the reference **web** project in the Vex Studio catalogue.

## Run

Open the project in the Vex Studio workspace and press **Run**. The preview runs the files inside a
sandboxed iframe (\`sandbox="allow-scripts"\`), so the game has no access to the studio session or the
admin APIs.

## Controls

| Input | Action |
| --- | --- |
| Space / click / tap | Reverse orbit (or restart after a crash) |
| Restart button | Reset score and obstacles |

## Files

- \`index.html\` – document shell, canvas and HUD
- \`styles.css\` – layout, responsive canvas, focus styles
- \`game.js\` – game loop, collision checks, local best score
`,
  },
];

const PY_FILES: ProjectFile[] = [
  {
    path: "main.py",
    content: `"""Vex Py Toolkit - demo Python project that runs on Pyodide in the browser."""

from utils import (
    fizzbuzz,
    most_common_words,
    prime_factors,
    statistics_summary,
)


def demo() -> str:
    lines = []
    lines.append("fizzbuzz(15)      -> " + ", ".join(fizzbuzz(15)))
    lines.append("prime_factors(360) -> " + " x ".join(str(p) for p in prime_factors(360)))
    lines.append("summary([1..10])   -> " + str(statistics_summary(list(range(1, 11)))))
    sample = "the quick brown fox jumps over the lazy dog the fox"
    lines.append("top words          -> " + str(most_common_words(sample, 3)))
    return "\\n".join(lines)


if __name__ == "__main__":
    print("Vex Py Toolkit")
    print(demo())
`,
  },
  {
    path: "utils.py",
    content: `"""Pure standard-library helpers used by the Vex Py Toolkit demo."""

from collections import Counter


def fizzbuzz(limit: int) -> list[str]:
    result = []
    for n in range(1, limit + 1):
        if n % 15 == 0:
            result.append("FizzBuzz")
        elif n % 3 == 0:
            result.append("Fizz")
        elif n % 5 == 0:
            result.append("Buzz")
        else:
            result.append(str(n))
    return result


def prime_factors(value: int) -> list[int]:
    if value < 2:
        return []
    factors: list[int] = []
    remaining = value
    divisor = 2
    while divisor * divisor <= remaining:
        while remaining % divisor == 0:
            factors.append(divisor)
            remaining //= divisor
        divisor += 1
    if remaining > 1:
        factors.append(remaining)
    return factors


def statistics_summary(values: list[float]) -> dict[str, float]:
    if not values:
        raise ValueError("statistics_summary requires at least one value")
    ordered = sorted(values)
    count = len(ordered)
    middle = count // 2
    median = ordered[middle] if count % 2 else (ordered[middle - 1] + ordered[middle]) / 2
    return {
        "count": count,
        "sum": sum(ordered),
        "mean": sum(ordered) / count,
        "median": median,
        "min": ordered[0],
        "max": ordered[-1],
    }


def most_common_words(text: str, limit: int = 5) -> list[tuple[str, int]]:
    words = [w.strip(".,!?;:()").lower() for w in text.split()]
    words = [w for w in words if w]
    return Counter(words).most_common(limit)
`,
  },
  {
    path: "tests/test_utils.py",
    content: `"""Lightweight checks that run inside Pyodide (no pytest needed)."""

from utils import fizzbuzz, most_common_words, prime_factors, statistics_summary


def run_all() -> list[str]:
    results = []

    assert fizzbuzz(5) == ["1", "2", "Fizz", "4", "Buzz"], "fizzbuzz(5) mismatch"
    results.append("PASS fizzbuzz(5)")

    assert prime_factors(360) == [2, 2, 2, 3, 3, 5], "prime_factors(360) mismatch"
    results.append("PASS prime_factors(360)")

    summary = statistics_summary([1, 2, 3, 4])
    assert summary["count"] == 4 and summary["mean"] == 2.5 and summary["median"] == 2.5
    results.append("PASS statistics_summary")

    assert most_common_words("a a b", 2)[0] == ("a", 2), "most_common_words mismatch"
    results.append("PASS most_common_words")

    return results


if __name__ == "__main__":
    for line in run_all():
        print(line)
`,
  },
  {
    path: "requirements.txt",
    content: `# Standard library only: everything below would be resolved with micropip.
# Left empty on purpose so the project runs with no network access at all.
`,
  },
  {
    path: "README.md",
    content: `# Vex Py Toolkit

Reference **Python** project for the Vex Studio catalogue. It uses only the Python standard library so
it runs inside Pyodide with no extra downloads.

## Run

1. Open the project in the workspace (creates an independent local mod).
2. Go to the **Runtime** panel, choose *Python (Pyodide)* and press **Run**.
3. Optional: run \`tests/test_utils.py\` and watch the real assertion output in the console.

## Modules

| File | Responsibility |
| --- | --- |
| \`main.py\` | Demo entry point with a \`__main__\` guard |
| \`utils.py\` | \`fizzbuzz\`, \`prime_factors\`, \`statistics_summary\`, \`most_common_words\` |
| \`tests/test_utils.py\` | Assertion based smoke tests executed by Pyodide |
`,
  },
];

function seedProject(input: {
  id: string;
  name: string;
  description: string;
  category: string;
  files: ProjectFile[];
  docsUrl: string;
}) {
  const detected = {
    kind: input.files.some((f) => f.path.endsWith(".py")) ? "python" : "web",
  };
  const checks = runStaticChecks(input.files);
  const manifest = buildManifest({ id: input.id, name: input.name, description: input.description, version: "1.0.0", files: input.files });
  manifest.testStatus = checks.summary === "fail" ? "fail" : "pass";

  return {
    project: {
      id: input.id,
      name: input.name,
      description: input.description,
      category: input.category,
      kind: detected.kind,
      runtimes: manifest.runtimes,
      dependencies: manifest.dependencies,
      entryFile: manifest.entryFile,
      manifest: manifest as unknown as Record<string, unknown>,
      testSummary: { summary: checks.summary, checks } as unknown as Record<string, unknown>,
      docsUrl: input.docsUrl,
      repositoryPath: `projects/${input.id}`,
      status: "published",
      latestVersion: "1.0.0",
      latestVersionId: null as string | null,
      latestCommitSha: null as string | null,
    },
    files: input.files,
    version: "1.0.0",
    manifest,
    checks,
  };
}

let seedPromise: Promise<void> | null = null;

/** Idempotent seed of the two reference projects. Safe to call on every request. */
export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      const existing = await db.select({ id: projects.id }).from(projects).limit(1);
      if (existing.length > 0) return;

      const orbit = seedProject({
        id: "vex-orbit",
        name: "Vex Orbit",
        description: "Canvas arcade game: reverse your orbit, collect gems and dodge debris. Pure HTML/CSS/JS.",
        category: "game",
        files: ORBIT_FILES,
        docsUrl: "https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API",
      });
      const py = seedProject({
        id: "vex-py-toolkit",
        name: "Vex Py Toolkit",
        description: "Standard-library Python toolkit (number theory, text stats) with assertion tests that run on Pyodide.",
        category: "toolkit",
        files: PY_FILES,
        docsUrl: "https://pyodide.org/en/stable/",
      });

      for (const seeded of [orbit, py]) {
        const [version] = await db
          .insert(projectVersions)
          .values({
            projectId: seeded.project.id,
            version: seeded.version,
            changelog: "Initial published version.",
            fileCount: seeded.files.length,
            totalBytes: seeded.manifest.totalBytes,
            manifest: seeded.manifest as unknown as Record<string, unknown>,
            testSummary: { summary: seeded.checks.summary, checks: seeded.checks.checks } as unknown as Record<string, unknown>,
            publishState: "stored",
            githubVerified: false,
            active: true,
          })
          .returning({ id: projectVersions.id });

        await db.insert(projectFiles).values(
          seeded.files.map((file) => ({
            versionId: version.id,
            path: file.path,
            content: file.content,
            size: new TextEncoder().encode(file.content).length,
          })),
        );

        await db.insert(projects).values({
          ...seeded.project,
          latestVersionId: version.id,
        });
      }

      await logEvent("info", "seed", "Seeded reference projects", { projects: [orbit.project.id, py.project.id] });
    })().catch(async (error) => {
      seedPromise = null;
      await logEvent("error", "seed", `Seeding failed: ${error instanceof Error ? error.message : "unknown"}`);
      throw error;
    });
  }
  return seedPromise;
}

export async function catalogIsPopulated(): Promise<boolean> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(projects).where(eq(projects.status, "published"));
  return (rows[0]?.count ?? 0) > 0;
}
