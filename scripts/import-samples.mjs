import fs from "node:fs/promises";
import path from "node:path";

const origin =
  "https://ielts.org/take-a-test/preparation-resources/sample-test-questions/general-training-test";
const html = await fs
  .readFile("source-page.html", "utf8")
  .catch(async () => (await fetch(origin)).text());
const manifest = [];
for (const [tab, section] of [
  [1, "listening"],
  [2, "reading"],
  [3, "writing"],
  [5, "speaking"],
]) {
  const panel = html.split(`data-tab="${tab}">`)[1]?.split("</div>")[0] || "";
  for (const a of panel.matchAll(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/g)) {
    const url = a[1].replaceAll("&amp;", "&");
    if (!url || (!url.includes("assessmentRunId") && !url.endsWith(".pdf")))
      continue;
    const id = new URL(url).searchParams.get("assessmentRunId");
    const file = id
      ? `${section}-${id}.json`
      : new URL(url).pathname.split("/").pop();
    const endpoint = id
      ? `https://ielts.inspera.com/ICSXapi/testplayer/GetQuestionSet?assessmentRunId=${id}&context=exam`
      : url;
    const target = path.join("data/raw", file);
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
      manifest.push({
        section,
        title: a[2].replace(/<[^>]+>/g, ""),
        url,
        file,
        kind: id ? "questions" : "pdf",
      });
      console.log("Imported", file);
    } catch (e) {
      console.error("FAILED", url, e.message);
      process.exitCode = 1;
    }
  }
}
await fs.writeFile(
  "data/sources.json",
  JSON.stringify(
    { origin, importedAt: new Date().toISOString(), assets: manifest },
    null,
    2,
  ),
);
