# uplink

Bun, not Node: `bun <file>`, `bun test`, `bun build`, `bun install`, `bun run <script>`, `bunx`. Bun loads `.env` itself, no dotenv.

Use Bun's built-ins over packages: `Bun.serve()` (routes, WebSockets, HTTPS) instead of express or ws, `bun:sqlite`, `Bun.redis`, `Bun.sql`, `Bun.file`, `Bun.$`. Frontend uses HTML imports with `Bun.serve()`, not Vite: `import index from "./index.html"` in routes, and HTML can import `.tsx` and `.css` directly. Run with `bun --hot ./index.ts`. API docs live in `node_modules/bun-types/docs/**.mdx`.

Tests: `bun test`, `import { test, expect } from "bun:test"`.

Commit freely and push your own branches. Pushing to `main` needs one explicit ok per job: wait for it, and that one approval covers every later push in the same job.
