export const STORAGE_KEY = "ielts-baseline:v1";
export const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[-‐‑–]/g, " ")
    .replace(/\s+/g, " ");
export const halfBand = (value) => Math.round(value * 2) / 2;
export function freshAttempt(test) {
  return {
    id: globalThis.crypto.randomUUID(),
    testId: test.id,
    createdAt: Date.now(),
    sections: Object.fromEntries(
      test.sections.map((s) => [
        s.id,
        { status: "ready", deadline: null, answers: {}, index: 0 },
      ]),
    ),
    results: null,
    speakingScores: {},
  };
}
export function beginSection(section, state, now = Date.now()) {
  return state.status === "ready"
    ? { ...state, status: "active", deadline: now + section.minutes * 60000 }
    : state;
}
export function expireAttempt(attempt, now = Date.now()) {
  let changed = false;
  const sections = { ...attempt.sections };
  for (const [id, s] of Object.entries(sections))
    if (s.status === "active" && s.deadline <= now) {
      sections[id] = { ...s, status: "expired", finishedAt: s.deadline };
      changed = true;
    }
  return changed ? { ...attempt, sections } : attempt;
}
export const finished = (state) =>
  state.status === "completed" || state.status === "expired";
export const allFinished = (attempt) =>
  Object.values(attempt.sections).every(finished);
export const isAnswered = (value) =>
  Array.isArray(value)
    ? value.length > 0
    : String(value ?? "").trim().length > 0;
export function labelAnswer(field, value) {
  const label = (v) => field.options?.find((o) => o.value === v)?.label ?? v;
  return Array.isArray(value)
    ? value.map(label).join("; ")
    : label(value || "") || "No answer";
}
export function gradeObjective(section, answers, keys) {
  let score = 0,
    total = 0;
  const review = [];
  for (const task of section.tasks) {
    const expected = keys[task.id];
    if (!expected || expected.length !== task.fields.length)
      throw new Error("Answer key mismatch: " + task.id);
    const used = new Set();
    task.fields.forEach((f, i) => {
      total += f.points;
      const raw = answers[f.id] ?? (f.type === "multi" ? [] : "");
      let awarded = 0,
        correct = expected[i];
      if (task.id === "listening-189694459") {
        const match = expected.findIndex(
          (variants, j) =>
            !used.has(j) &&
            variants.some((v) => normalize(v) === normalize(raw)),
        );
        if (match >= 0) {
          used.add(match);
          awarded = 1;
        }
        correct = expected.flat();
      } else if (f.type === "multi") {
        const selected = Array.isArray(raw)
          ? [...new Set(raw)].slice(0, f.max)
          : [];
        awarded = selected.filter((v) => correct.includes(v)).length;
      } else
        awarded = (Array.isArray(correct) ? correct : [correct]).some(
          (v) => normalize(v) === normalize(raw),
        )
          ? 1
          : 0;
      score += awarded;
      review.push({
        taskId: task.id,
        title: task.title,
        topic: task.topic,
        number: f.number,
        answer: labelAnswer(f, raw),
        correct: Array.isArray(correct)
          ? correct.map((v) => labelAnswer(f, v)).join(" / ")
          : labelAnswer(f, correct),
        score: awarded,
        total: f.points,
      });
    });
  }
  return {
    score,
    total,
    percentage: Math.round((score / total) * 100),
    review,
  };
}
