import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { load } from "cheerio";
import {
  freshAttempt,
  beginSection,
  expireAttempt,
  allFinished,
  gradeObjective,
} from "../src/engine.mjs";
import { evaluateWriting, validateEvaluation } from "../server/evaluation.mjs";
import { apiHandler, startServer } from "../server.mjs";
const dataset = JSON.parse(await fs.readFile("data/test.json", "utf8"));
const keys = JSON.parse(await fs.readFile("data/keys.json", "utf8"));
const objective = dataset.sections.filter((s) =>
  ["reading", "listening"].includes(s.id),
);

test("task headings agree with imported question formats and passage subjects", async () => {
  for (const section of dataset.sections.filter((s) => s.id !== "speaking")) {
    for (const task of section.tasks) {
      const raw = JSON.parse(
        await fs.readFile(`data/raw/${task.id}.json`, "utf8"),
      );
      const sourceQuestions = raw.sections.flatMap((s) => s.questions);
      assert(
        sourceQuestions.every((q) =>
          q.customFields.some(
            (f) =>
              f.name === "Testing Focus level 1" &&
              f.value.includes(section.title),
          ),
        ),
      );
      assert(task.topic?.trim(), `Missing subject for ${task.id}`);
      if (section.id === "reading") {
        const $ = load(task.passage);
        assert.equal(task.topic, $("h1,h3").first().text().trim());
      }
    }
  }
  const reading = dataset.sections.find((s) => s.id === "reading");
  const insurance = reading.tasks.find((t) => t.id === "reading-189732842");
  assert.equal(insurance.title, "Sentence completion");
  assert.match(load(insurance.html).text(), /accident protection/);
  const internships = reading.tasks.find((t) => t.id === "reading-205994164");
  assert.equal(internships.title, "Note completion");
  assert(load(internships.html)("ul li").length > 0);
  assert.match(internships.topic, /INTERNSHIPS/);
});
test("import contains every sample group and local media, with no scorer rubric or key in question markup", async () => {
  assert.deepEqual(
    dataset.sections.map((s) => [s.tasks.length, s.questionCount]),
    [
      [7, 34],
      [2, 2],
      [8, 33],
      [14, 14],
    ],
  );
  for (const section of dataset.sections)
    for (const task of section.tasks) {
      const $ = load(task.html);
      assert.equal(
        $("[data-field]").length,
        task.fields.reduce(
          (n, f) =>
            n +
            (f.type === "multi" || (f.type === "choice" && f.max)
              ? f.options.length
              : 1),
          0,
        ),
      );
      assert.equal($("rubricblock,script").length, 0);
      assert(!task.html.includes("data-aspect-id"));
      for (const img of load(task.passage + task.html)("img").toArray())
        await fs.access("public" + img.attribs.src);
      if (task.audio) await fs.access("public" + task.audio);
    }
});
test("every official correct answer receives full marks; blanks receive zero", () => {
  for (const section of objective) {
    const answers = {};
    for (const t of section.tasks)
      t.fields.forEach((f, i) => {
        const key = keys[t.id][i];
        answers[f.id] =
          f.type === "multi" ? key : Array.isArray(key) ? key[0] : key;
      });
    const score = gradeObjective(section, answers, keys);
    assert.equal(score.score, section.questionCount);
    assert.equal(score.total, section.questionCount);
    assert.equal(gradeObjective(section, {}, keys).score, 0);
  }
});
test("any-order short answers do not award duplicate credit", () => {
  const section = dataset.sections.find((s) => s.id === "listening");
  const task = section.tasks.find((t) => t.id === "listening-189694459");
  const only = { ...section, tasks: [task] };
  const answers = Object.fromEntries(
    task.fields.map((f, i) => [
      f.id,
      ["ACCOUNTANTS", "scientist", "engineers"][i],
    ]),
  );
  assert.equal(gradeObjective(only, answers, keys).score, 3);
  for (const f of task.fields) answers[f.id] = "scientist";
  assert.equal(gradeObjective(only, answers, keys).score, 1);
});
test("multi-select is order independent, bounded, and does not double-count duplicates", () => {
  const s = dataset.sections[0],
    t = s.tasks[0],
    f = t.fields[0],
    only = { ...s, tasks: [t] };
  assert.equal(gradeObjective(only, { [f.id]: ["D", "A"] }, keys).score, 2);
  assert.equal(gradeObjective(only, { [f.id]: ["A", "A"] }, keys).score, 1);
  assert.equal(
    gradeObjective(only, { [f.id]: ["A", "B", "C", "D", "E"] }, keys).score,
    1,
  );
});
test("case and whitespace normalize but incorrect spelling is rejected", () => {
  const s = dataset.sections[0],
    t = s.tasks.find((t) => t.id === "reading-189732477"),
    only = { ...s, tasks: [t] };
  assert.equal(
    gradeObjective(only, { [t.fields[0].id]: "  FOREST  " }, keys).score,
    1,
  );
  assert.equal(
    gradeObjective(only, { [t.fields[0].id]: "forests" }, keys).score,
    0,
  );
});
test("deadlines survive reload, never reset on resume, and expire unfinished sections", () => {
  const a = freshAttempt(dataset);
  a.sections.reading = beginSection(
    dataset.sections[0],
    a.sections.reading,
    1000,
  );
  assert.equal(a.sections.reading.deadline, 3601000);
  a.sections.reading.answers = { sample: "retained" };
  const reloaded = JSON.parse(JSON.stringify(a));
  assert.equal(
    beginSection(dataset.sections[0], reloaded.sections.reading, 3000).deadline,
    3601000,
  );
  assert.equal(
    expireAttempt(reloaded, 3600999).sections.reading.status,
    "active",
  );
  const expired = expireAttempt(reloaded, 3601000);
  assert.equal(expired.sections.reading.status, "expired");
  assert.equal(expired.sections.reading.answers.sample, "retained");
  assert.equal(allFinished(expired), false);
  for (const s of Object.values(expired.sections)) s.status = "completed";
  assert.equal(allFinished(expired), true);
});
const taskFeedback = () => ({
  taskResponse: { score: 6, feedback: "Specific feedback" },
  coherence: { score: 6, feedback: "Specific feedback" },
  vocabulary: { score: 6, feedback: "Specific feedback" },
  grammar: { score: 6, feedback: "Specific feedback" },
  strengths: ["Clear purpose"],
  improvements: ["Develop ideas"],
});
test("Writing validates criterion bands and weights Task 2 twice", () => {
  const result = { task1: taskFeedback(), task2: taskFeedback() };
  for (const c of ["taskResponse", "coherence", "vocabulary", "grammar"])
    result.task2[c].score = 7.5;
  assert.equal(validateEvaluation(result).band, 7);
  result.task1.grammar.score = 11;
  assert.throws(() => validateEvaluation(result), /Invalid criterion/);
});
test("Writing API uses structured output, sends no audio, and handles missing key / provider failures", async () => {
  const params = {
    answers: {},
    tasks: dataset.sections[1].tasks,
    reference: "Examiner reference",
    apiKey: "test-only",
    model: "test-model",
  };
  let called = false;
  const result = await evaluateWriting({
    ...params,
    fetcher: async (url, init) => {
      called = true;
      assert.equal(url, "https://api.openai.com/v1/responses");
      const b = JSON.parse(init.body);
      assert.equal(b.text.format.strict, true);
      assert.equal(b.store, false);
      assert.equal(b.model, "test-model");
      assert.equal(JSON.parse(b.input).tasks.length, 2);
      assert(!b.input.includes("audio"));
      return {
        ok: true,
        json: async () => ({
          status: "completed",
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    task1: taskFeedback(),
                    task2: taskFeedback(),
                  }),
                },
              ],
            },
          ],
        }),
      };
    },
  });
  assert(called);
  assert.equal(result.band, 6);
  await assert.rejects(
    evaluateWriting({ ...params, apiKey: "" }),
    /OPENAI_API_KEY/,
  );
  await assert.rejects(
    evaluateWriting({
      ...params,
      fetcher: async () => ({ ok: false, status: 401 }),
    }),
    /rejected/,
  );
});
test("scores API gates completion, rejects cross-origin calls, and preserves objective scores on Writing failure", async () => {
  const server = http.createServer((req, res) =>
    apiHandler(req, res, {
      evaluator: async () => {
        throw new Error("Missing test key");
      },
    }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let res = await fetch(base + "/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections: {} }),
    });
    assert.equal(res.status, 400);
    res = await fetch(base + "/api/test", {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(res.status, 403);
    const a = freshAttempt(dataset);
    for (const s of Object.values(a.sections)) s.status = "completed";
    res = await fetch(base + "/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(a),
    });
    assert.equal(res.status, 200);
    const result = await res.json();
    assert.equal(result.reading.total, 34);
    assert.equal(result.listening.total, 33);
    assert.equal(result.writingError, "Missing test key");
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test("production serves the app and audio ranges, while keeping .env and answer keys private", async () => {
  const app = await startServer({ production: true, port: 0 });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(base + "/data/keys.json")).status, 404);
    assert.equal((await fetch(base + "/.env")).status, 404);
    const r = await fetch(base + dataset.sections[2].tasks[0].audio, {
      headers: { Range: "bytes=0-99" },
    });
    assert.equal(r.status, 206);
    assert.equal((await r.arrayBuffer()).byteLength, 100);
  } finally {
    await app.close();
  }
});
