import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
import { indexedDB } from "fake-indexeddb";
const source = await fs.readFile("src/recordings.ts", "utf8");
const moduleText = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const recording = await import(
  "data:text/javascript;base64," + Buffer.from(moduleText).toString("base64")
);
test("microphone chunks and final data persist; stopping releases the microphone; reset clears recordings", async () => {
  globalThis.indexedDB = indexedDB;
  let released = 0;
  Object.defineProperty(globalThis, "navigator", {
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => released++ }],
        }),
      },
    },
    configurable: true,
  });
  class FakeRecorder {
    state = "inactive";
    mimeType = "audio/webm";
    start() {
      this.state = "recording";
      this.ondataavailable({ data: new Blob(["first"]) });
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable({ data: new Blob(["final"]) });
      this.onstop();
    }
  }
  globalThis.MediaRecorder = FakeRecorder;
  globalThis.window = { MediaRecorder: FakeRecorder };
  const errors = [];
  const handle = await recording.record("test-attempt", "speaking-0", (e) =>
    errors.push(e),
  );
  await handle.stop();
  assert.equal(released, 1);
  assert.deepEqual(errors, []);
  const clips = await recording.clipsFor("test-attempt");
  assert.equal(clips.length, 1);
  assert.equal(clips[0].chunks.length, 2);
  assert.equal(await new Blob(clips[0].chunks).text(), "firstfinal");
  assert.equal((await recording.clipsFor("another-attempt")).length, 0);
  await handle.stop();
  assert.equal(released, 1);
  await recording.clearClips();
  assert.equal((await recording.clipsFor("test-attempt")).length, 0);
});
test("microphone permission errors are returned to the caller", async () => {
  Object.defineProperty(globalThis, "navigator", {
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        },
      },
    },
    configurable: true,
  });
  await assert.rejects(
    recording.record("test", "prompt", () => {}),
    { name: "NotAllowedError" },
  );
});
