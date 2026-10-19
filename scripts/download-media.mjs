import fs from "node:fs/promises";
const media = {};
for (const file of (await fs.readdir("data/raw")).filter((x) =>
  x.endsWith(".json"),
)) {
  const d = JSON.parse(await fs.readFile("data/raw/" + file, "utf8"));
  const resources = [
    ...(d.additionalResources || []),
    ...d.sections.flatMap((s) => [
      ...(s.additionalResources || []),
      ...s.questions.flatMap((q) => q.mediaInfo || []),
    ]),
  ];
  for (const r of resources) {
    const m = r.mediaInfo || r;
    if (!m.presignedURL || media[m.logicalName]) continue;
    const ext = decodeURIComponent(new URL(m.presignedURL).pathname)
      .split(".")
      .pop();
    const local = `/assets/${m.contentItemId}.${ext}`;
    const response = await fetch(m.presignedURL);
    if (!response.ok)
      throw new Error(`Download failed ${m.contentItemId}: ${response.status}`);
    await fs.writeFile(
      "public" + local,
      Buffer.from(await response.arrayBuffer()),
    );
    media[m.logicalName] = local;
    console.log("Downloaded", local);
  }
}
await fs.writeFile("data/media.json", JSON.stringify(media, null, 2));
