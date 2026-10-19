import fs from "node:fs/promises";
import { load } from "cheerio";
const sources = JSON.parse(await fs.readFile("data/sources.json", "utf8"));
const media = JSON.parse(await fs.readFile("data/media.json", "utf8"));
const topics = {
  "writing-189733708": "Letter to a college accommodation officer",
  "writing-189733579": "Who should pay for care for older people?",
  "listening-189697549": "Judy’s research on the East End of London",
  "listening-189696950": "Guide to the Library",
  "listening-189695339": "A town street plan",
  "listening-189696078": "Phone call about second-hand furniture",
  "listening-189652254": "Research findings on learner persistence",
  "listening-189697842": "Procedure for detecting life on another planet",
  "listening-189694885": "Studying with the Open University",
  "listening-189694459": "Staff recruitment at Pacific Clothing",
};
const taskTypes = {
  "MC Questions": "Multiple choice (one answer)",
  "MC Questions (multi-answer)": "Multiple choice (more than one answer)",
  "T-F-NG": "True/False/Not Given",
  "Matching Information GTR3": "Matching information",
  "Matching Features": "Matching features",
  "Summary Completion Productive": "Summary completion",
  "Sentence Completion": "Sentence completion",
  "Note Completion": "Note completion",
  "Table Completion": "Table completion",
  "Plan, Map, Diagram Labelling": "Plan/Map/Diagram labelling",
  "Flow-chart Completion Objective": "Flow-chart completion",
  "Short Answer Questions": "Short-answer questions",
};
const escape = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const allowed = new Set(
  "div span p h1 h2 h3 h4 ul ol li strong b em i br table tbody thead tr td th blockquote img input select option label fieldset legend textarea".split(
    " ",
  ),
);
function clean(html) {
  const $ = load(html, { xmlMode: true });
  $("rubricBlock,script,style").remove();
  $("img").each((_, el) => {
    const src = media[$(el).attr("data-logicalname")];
    if (!src) throw new Error("Missing image");
    $(el)
      .attr("src", src)
      .attr("alt", "Street plan with labelled locations A–H");
  });
  $("*").each((_, el) => {
    if (!allowed.has(el.name)) {
      $(el).replaceWith($(el).contents());
      return;
    }
    for (const a of Object.keys(el.attribs))
      if (
        ![
          "class",
          "src",
          "alt",
          "type",
          "name",
          "value",
          "data-field",
          "data-max",
          "aria-label",
          "rows",
          "colspan",
          "rowspan",
        ].includes(a)
      )
        $(el).removeAttr(a);
  });
  return $.html({ xmlMode: false });
}
const result = {
  id: "ielts-general-samples-v1",
  title: "IELTS General Training · Official samples",
  source: sources.origin,
  sections: [],
};
for (const section of ["reading", "writing", "listening"]) {
  let number = 0;
  const tasks = [];
  for (const asset of sources.assets.filter(
    (a) => a.section === section && a.kind === "questions",
  )) {
    const d = JSON.parse(await fs.readFile("data/raw/" + asset.file, "utf8"));
    const task = {
      id: asset.file.replace(".json", ""),
      title: asset.title
        .replace("General Training Sample task - ", "")
        .replace("Writing - Part ", "Task "),
      source: asset.url,
      passage: "",
      html: "",
      fields: [],
      instructions: "",
      audio: null,
      topic: topics[asset.file.replace(".json", "")] || "",
    };
    const audio = d.additionalResources?.find((r) => r.type === "audio");
    if (audio) task.audio = media[audio.logicalName];
    let fieldIndex = 0;
    const field = (type, opts = {}) => {
      const points = opts.max || 1;
      const f = {
        id: `${task.id}:${fieldIndex++}`,
        type,
        number: number + 1,
        points,
        ...opts,
      };
      number += points;
      task.fields.push(f);
      return f;
    };
    const select = (f, options) =>
      `<select data-field="${f.id}" aria-label="Question ${f.number}"><option value="">Choose…</option>${options.map((o) => `<option value="${escape(o.value)}">${escape(o.label)}</option>`).join("")}</select>`;
    for (const s of d.sections)
      for (const q of s.questions) {
        const $ = load(q.itemBody, { xmlMode: true });
        if (q.category === "stimulus") {
          task.passage += clean(q.itemBody);
          if (!task.topic) task.topic = $("h1,h3").first().text().trim();
          continue;
        }
        const declaredType = q.customFields.find(
          (f) => f.name === "Item Type" || f.name === "Item Sub Type",
        )?.value?.[0];
        if (section !== "writing" && taskTypes[declaredType])
          task.title = taskTypes[declaredType];
        const variant = q.customFields.find(
          (f) => f.name === "Item Rubric Variant",
        )?.value?.[0];
        task.instructions = variant
          ? `${variant}${section === "reading" ? " from the passage" : ""}.`
          : "";
        $("rubricBlock").remove();
        $("choiceInteraction").each((_, el) => {
          const max = Number($(el).attr("maxChoices")) || 1;
          const options = $(el)
            .find("simpleChoice")
            .toArray()
            .map((n) => ({
              value: $(n).attr("identifier"),
              label: $(n).text().trim(),
            }));
          const f = field(max > 1 ? "multi" : "choice", { max, options });
          const prompt = $(el).find("prompt").html() || "";
          $(el).replaceWith(
            `<fieldset class="choice-question"><legend><span class="question-number">${f.number}${max > 1 ? "–" + (f.number + max - 1) : ""}</span> ${prompt}</legend>${max > 1 ? `<p class="hint">Choose ${max} answers.</p>` : ""}${options.map((o) => `<label class="option"><input type="${max > 1 ? "checkbox" : "radio"}" name="${f.id}" data-field="${f.id}" data-max="${max}" value="${escape(o.value)}"><span>${escape(o.label)}</span></label>`).join("")}</fieldset>`,
          );
        });
        $("matchInteraction").each((_, el) => {
          const sets = $(el).find("simpleMatchSet").toArray();
          const options = $(sets[1])
            .find("simpleAssociableChoice")
            .toArray()
            .map((n) => ({
              value: $(n).attr("identifier"),
              label: $(n).text().trim(),
            }));
          const rows = $(sets[0])
            .find("simpleAssociableChoice")
            .toArray()
            .map((n) => {
              const f = field("choice", { options });
              return `<div class="match-row"><label><span class="question-number">${f.number}</span> ${$(n).text().trim()} ${select(f, options)}</label></div>`;
            });
          $(el).replaceWith(
            `<div><p>${$(el).find("prompt").text()}</p>${rows.join("")}</div>`,
          );
        });
        $("gapMatchInteraction").each((_, el) => {
          const options = $(el)
            .find("gapText")
            .toArray()
            .map((n) => ({
              value: $(n).attr("identifier"),
              label: $(n).text().trim(),
            }));
          $(el).find("gapText,prompt").remove();
          $(el)
            .find("gap")
            .each((_, n) => {
              const f = field("choice", { options });
              $(n).replaceWith(
                `<span class="question-number">${f.number}</span> ${select(f, options)}`,
              );
            });
          $(el).replaceWith($(el).contents());
        });
        $("textEntryInteraction").each((_, el) => {
          const f = field("text");
          $(el).replaceWith(
            `<span class="inline-answer"><span class="question-number">${f.number}</span><input type="text" data-field="${f.id}" aria-label="Question ${f.number}"></span>`,
          );
        });
        $("extendedTextInteraction").each((_, el) => {
          const f = field("essay");
          $(el).replaceWith(
            `<textarea data-field="${f.id}" aria-label="Your response for ${task.title}" rows="18"></textarea>`,
          );
        });
        task.html += clean($.html());
      }
    if (section === "writing")
      task.instructions = task.title.includes("1")
        ? "Spend about 20 minutes. Write at least 150 words."
        : "Spend about 40 minutes. Write at least 250 words.";
    tasks.push(task);
  }
  result.sections.push({
    id: section,
    title: section[0].toUpperCase() + section.slice(1),
    minutes: section === "listening" ? 30 : 60,
    questionCount: number,
    tasks,
  });
}
const speaking = [
  ["Part 1 · Home town", "What kind of place is your home town or village?"],
  [
    "Part 1 · Home town",
    "What’s the most interesting part of your town/village?",
  ],
  [
    "Part 1 · Home town",
    "What kind of jobs do the people in your town/village do?",
  ],
  ["Part 1 · Home town", "Would you say it’s a good place to live? Why?"],
  [
    "Part 1 · Accommodation",
    "Tell me about the kind of accommodation you live in.",
  ],
  ["Part 1 · Accommodation", "How long have you lived there?"],
  ["Part 1 · Accommodation", "What do you like about living there?"],
  [
    "Part 1 · Accommodation",
    "What sort of accommodation would you most like to live in?",
  ],
  [
    "Part 2 · An important possession",
    "Describe something you own which is very important to you.\n\nYou should say:\n• where you got it from\n• how long you have had it\n• what you use it for\n\nand explain why it is important to you.",
  ],
  ["Part 2 · Value of your possession", "Is it valuable in terms of money?"],
  ["Part 2 · Replacing your possession", "Would it be easy to replace?"],
  [
    "Part 3 · People’s values",
    "What kind of things give status to people in your country?",
  ],
  ["Part 3 · People’s values", "Have things changed since your parents’ time?"],
  [
    "Part 3 · Advertising",
    "Do you think advertising influences what people buy?",
  ],
];
result.sections.push({
  id: "speaking",
  title: "Speaking",
  minutes: 20,
  questionCount: speaking.length,
  tasks: speaking.map(([title, prompt], i) => ({
    id: `speaking-${i}`,
    title,
    passage: `<div class="speaking-prompt">${escape(prompt).replaceAll("\n", "<br>")}</div>`,
    html: "",
    instructions:
      i === 8
        ? "Take one minute to prepare, then speak for one to two minutes."
        : "Answer aloud. Record your response, then continue.",
    fields: [],
    source: sources.assets.find((a) => a.section === "speaking").url,
  })),
});
await fs.writeFile("data/test.json", JSON.stringify(result, null, 2));
console.log(
  result.sections
    .map(
      (s) =>
        `${s.title}: ${s.tasks.length} tasks, ${s.questionCount} questions`,
    )
    .join("\n"),
);
