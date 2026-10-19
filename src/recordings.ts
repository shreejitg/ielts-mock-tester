export type Clip = {
  id: string;
  attemptId: string;
  taskId: string;
  mime: string;
  chunks: Blob[];
  createdAt: number;
};
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("ielts-baseline-recordings", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("clips", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
export async function saveClip(clip: Clip) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction("clips", "readwrite");
    tx.objectStore("clips").put(clip);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Recording storage interrupted"));
  });
}
export async function clipsFor(attemptId: string) {
  const d = await db();
  return new Promise<Clip[]>((resolve, reject) => {
    const tx = d.transaction("clips", "readonly");
    const request = tx.objectStore("clips").getAll();
    request.onsuccess = () =>
      resolve(
        request.result
          .filter((c: Clip) => c.attemptId === attemptId)
          .sort((a: Clip, b: Clip) => a.createdAt - b.createdAt),
      );
    request.onerror = () => reject(request.error);
  });
}
export async function clearClips() {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = d.transaction("clips", "readwrite");
    tx.objectStore("clips").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function record(
  attemptId: string,
  taskId: string,
  onError: (error: string) => void,
) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw new Error(
      "Microphone recording is unavailable. Open the app on localhost in a current Chrome, Edge, or Firefox browser.",
    );
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const clip: Clip = {
    id: crypto.randomUUID(),
    attemptId,
    taskId,
    mime: recorder.mimeType,
    chunks: [],
    createdAt: Date.now(),
  };
  let saving = Promise.resolve();
  let failure: unknown;
  let doneResolve: () => void;
  const done = new Promise<void>((r) => {
    doneResolve = r;
  });
  recorder.ondataavailable = (e) => {
    if (e.data.size) {
      clip.chunks.push(e.data);
      saving = saving
        .then(() => saveClip({ ...clip, chunks: [...clip.chunks] }))
        .catch((err) => {
          failure = err;
          onError(
            "Could not save the microphone recording. Check available browser storage.",
          );
          if (recorder.state !== "inactive") recorder.stop();
        });
    }
  };
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    saving.finally(() => doneResolve());
  };
  recorder.onerror = () => {
    failure = new Error("Microphone recording failed");
    onError("Microphone recording failed.");
    if (recorder.state !== "inactive") recorder.stop();
  };
  recorder.start(3000);
  return {
    stop: async () => {
      if (recorder.state !== "inactive") recorder.stop();
      await done;
      if (failure) throw failure;
      return clip;
    },
  };
}
