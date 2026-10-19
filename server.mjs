import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradeObjective } from "./src/engine.mjs";
import { evaluateWriting } from "./server/evaluation.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
const test = JSON.parse(
  await fs.readFile(path.join(root, "data/test.json"), "utf8"),
);
const keys = JSON.parse(
  await fs.readFile(path.join(root, "data/keys.json"), "utf8"),
);
const reference = await fs.readFile(
  path.join(
    root,
    "data/raw/ielts-general-training-writing-example-responses-to-parts-1-and-2-with-band-scores-and-examiner-comments.txt",
  ),
  "utf8",
);
const json = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
};
export async function apiHandler(
  req,
  res,
  { evaluator = evaluateWriting } = {},
) {
  const host = req.headers.host || "";
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) {
    json(res, 403, { error: "Local access only" });
    return;
  }
  if (req.headers.origin && ![`http://${host}`].includes(req.headers.origin)) {
    json(res, 403, { error: "Origin rejected" });
    return;
  }
  if (req.url === "/api/test" && req.method === "GET") {
    json(res, 200, test);
    return;
  }
  if (req.url === "/api/config" && req.method === "GET") {
    json(res, 200, { writingConfigured: !!process.env.OPENAI_API_KEY });
    return;
  }
  if (req.url !== "/api/scores" || req.method !== "POST") {
    json(res, 404, { error: "Not found" });
    return;
  }
  try {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw Object.assign(new Error("JSON required"), { status: 415 });
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 100000)
        throw Object.assign(new Error("Request too large"), { status: 413 });
    }
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      throw Object.assign(new Error("Invalid JSON"), { status: 400 });
    }
    if (
      !input.sections ||
      !test.sections.every((s) =>
        ["completed", "expired"].includes(input.sections[s.id]?.status),
      )
    )
      throw Object.assign(
        new Error("Complete all four sections before calculating scores."),
        { status: 400 },
      );
    for (const s of test.sections) {
      const answers = input.sections[s.id].answers;
      if (!answers || typeof answers !== "object")
        throw Object.assign(new Error("Answers required"), { status: 400 });
      for (const v of Object.values(answers))
        if (!(
          (typeof v === "string" && v.length <= 20000) ||
          (Array.isArray(v) &&
            v.length <= 10 &&
            v.every((x) => typeof x === "string" && x.length < 200))
        ))
          throw Object.assign(new Error("Invalid answer"), { status: 400 });
    }
    const result = {
      reading: gradeObjective(
        test.sections[0],
        input.sections.reading.answers,
        keys,
      ),
      listening: gradeObjective(
        test.sections[2],
        input.sections.listening.answers,
        keys,
      ),
      writing: null,
      writingError: null,
    };
    if (input.evaluateWriting !== false) {
      try {
        result.writing = await evaluator({
          answers: input.sections.writing.answers,
          tasks: test.sections[1].tasks,
          reference,
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL || "gpt-4.1",
        });
      } catch (e) {
        result.writingError =
          e.name === "TimeoutError"
            ? "Writing evaluation timed out. You can retry without losing your other scores."
            : e.message;
      }
    }
    json(res, 200, result);
  } catch (e) {
    json(res, e.status || 500, {
      error: e.status ? e.message : "Unable to calculate scores. Please retry.",
    });
  }
}
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".json": "application/json",
};
export async function startServer({
  production = process.argv.includes("--production"),
  port = Number(process.env.PORT) || 3000,
} = {}) {
  const vite = production
    ? null
    : await (
        await import("vite")
      ).createServer({
        server: {
          middlewareMode: true,
          host: "127.0.0.1",
          allowedHosts: ["localhost", "127.0.0.1"],
          fs: {
            deny: [
              ".env",
              ".env.*",
              "*.{crt,pem}",
              "**/.git/**",
              "**/data/**",
              "**/server/**",
              "**/tests/**",
              "**/scripts/**",
              "**/server.mjs",
            ],
          },
        },
        appType: "spa",
      });
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith("/api/")) return apiHandler(req, res);
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || "")) {
      res.writeHead(403);
      res.end();
      return;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (
      /^\/(data|server|scripts|tests|\.git|\.env)(\/|\.|$)/.test(decoded) ||
      decoded === "/server.mjs"
    ) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    if (vite) return vite.middlewares(req, res);
    const pathname = new URL(req.url, "http://localhost").pathname;
    const target = path.join(
      root,
      "dist",
      pathname === "/" ? "index.html" : pathname,
    );
    if (!target.startsWith(path.join(root, "dist") + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const stat = await fs.stat(target);
      const range = req.headers.range;
      const headers = {
        "Content-Type":
          mime[path.extname(target)] || "application/octet-stream",
        "Accept-Ranges": "bytes",
      };
      if (range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!m) {
          res.writeHead(416);
          res.end();
          return;
        }
        const start = +m[1],
          end = m[2] ? Math.min(+m[2], stat.size - 1) : stat.size - 1;
        if (start > end) {
          res.writeHead(416);
          res.end();
          return;
        }
        const data = await fs.readFile(target);
        res.writeHead(206, {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Content-Length": end - start + 1,
        });
        res.end(data.subarray(start, end + 1));
      } else {
        res.writeHead(200, { ...headers, "Content-Length": stat.size });
        res.end(await fs.readFile(target));
      }
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  console.log(`Local: http://localhost:${server.address().port}`);
  return {
    server,
    close: async () => {
      await vite?.close();
      await new Promise((r) => server.close(r));
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  startServer().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
