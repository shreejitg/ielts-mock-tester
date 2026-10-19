import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  STORAGE_KEY,
  freshAttempt,
  beginSection,
  expireAttempt,
  allFinished,
  finished,
  isAnswered,
} from "./engine.mjs";
import { record, clipsFor, clearClips, type Clip } from "./recordings";
import "./style.css";

type Field = {
  id: string;
  type: string;
  number: number;
  points: number;
  max?: number;
  options?: { value: string; label: string }[];
};
type Task = {
  id: string;
  title: string;
  topic?: string;
  source: string;
  instructions: string;
  passage: string;
  html: string;
  fields: Field[];
  audio?: string;
};
type Section = {
  id: string;
  title: string;
  minutes: number;
  questionCount: number;
  tasks: Task[];
};
type Test = { id: string; title: string; source: string; sections: Section[] };
type SectionState = {
  status: string;
  deadline: number | null;
  answers: Record<string, string | string[]>;
  index: number;
  finishedAt?: number;
  audio?: { track: number; position: number; ended: boolean };
};
type Attempt = {
  id: string;
  testId: string;
  createdAt: number;
  sections: Record<string, SectionState>;
  results: any;
  speakingScores: Record<string, string>;
};
const descriptions: Record<string, string> = {
  reading: "Read closely. Find the details.",
  writing: "Make your point. Find your voice.",
  listening: "Tune in to everyday conversations.",
  speaking: "Speak naturally. Tell your story.",
};
const icons: Record<string, string> = {
  reading: "▤",
  writing: "✎",
  listening: "◉",
  speaking: "♬",
};
const title = (s: string) => s[0].toUpperCase() + s.slice(1);
function time(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
function readAttempt(test: Test): Attempt {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return freshAttempt(test) as Attempt;
  const saved = JSON.parse(raw);
  if (
    saved.testId !== test.id ||
    typeof saved.id !== "string" ||
    !saved.sections ||
    !test.sections.every((s) => {
      const p = saved.sections[s.id];
      return (
        p &&
        ["ready", "active", "expired", "completed"].includes(p.status) &&
        typeof p.answers === "object" &&
        p.answers &&
        Number.isInteger(p.index) &&
        p.index >= 0 &&
        p.index < s.tasks.length &&
        (p.status !== "active" || Number.isFinite(p.deadline))
      );
    })
  )
    throw new Error(
      "Your saved attempt could not be read. Clear saved test data below to begin a new attempt.",
    );
  return expireAttempt(saved) as Attempt;
}
function App() {
  const [test, setTest] = useState<Test | null>(null),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [view, setView] = useState("home"),
    [error, setError] = useState(""),
    [loadingError, setLoadingError] = useState(""),
    [notice, setNotice] = useState(""),
    [reset, setReset] = useState(false),
    [busy, setBusy] = useState(false),
    [configured, setConfigured] = useState(false),
    [now, setNow] = useState(Date.now());
  const current = useRef<Attempt | null>(null),
    stopRecording = useRef<null | (() => Promise<unknown>)>(null),
    requestGeneration = useRef(0);
  const write = (next: Attempt) => {
    current.current = next;
    setAttempt(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      setError(
        "Your browser could not save progress. Free some browser storage before continuing; this tab still holds your answers.",
      );
    }
  };
  useEffect(() => {
    fetch("/api/test")
      .then((r) => {
        if (!r.ok) throw new Error("Could not load the question set.");
        return r.json();
      })
      .then((t) => {
        setTest(t);
        try {
          const a = readAttempt(t);
          current.current = a;
          setAttempt(a);
        } catch (e) {
          setLoadingError((e as Error).message);
        }
      })
      .catch((e) => setLoadingError(e.message));
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setConfigured(c.writingConfigured))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      const a = current.current;
      if (!a) return;
      const next = expireAttempt(a, n) as Attempt;
      if (next !== a) {
        const expired = Object.keys(a.sections).find(
          (k) =>
            a.sections[k].status === "active" &&
            next.sections[k].status === "expired",
        );
        write(next);
        if (expired) {
          void stopRecording.current?.().catch(() => {});
          setNotice(
            `${title(expired)} time is up. Answers are locked and saved. Returning to the dashboard…`,
          );
          setTimeout(() => setView((v) => (v === expired ? "home" : v)), 2200);
        }
      }
    }, 250);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && test) {
        try {
          const a = readAttempt(test);
          current.current = a;
          setAttempt(a);
        } catch {
          setError("Saved test data changed in another tab. Reload this page.");
        }
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [test]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);
  const patchSection = (id: string, patch: Partial<SectionState>) => {
    const a = current.current;
    if (!a) return;
    write({
      ...a,
      sections: { ...a.sections, [id]: { ...a.sections[id], ...patch } },
    });
  };
  const saveAnswer = (id: string, field: string, value: string | string[]) => {
    const a = current.current;
    if (!a) return;
    const s = a.sections[id];
    if (s.status !== "active" || (s.deadline || 0) <= Date.now()) return;
    patchSection(id, { answers: { ...s.answers, [field]: value } });
  };
  const start = (s: Section) => {
    const a = current.current;
    if (!a) return;
    const state = a.sections[s.id];
    if (state.status === "ready") {
      write({
        ...a,
        sections: { ...a.sections, [s.id]: beginSection(s, state) },
      } as Attempt);
    }
    setNotice("");
    setView(s.id);
  };
  const finish = async (id: string) => {
    setBusy(true);
    try {
      await stopRecording.current?.();
      const a = current.current;
      if (a) {
        const state = a.sections[id];
        patchSection(id, {
          status: (state.deadline || 0) <= Date.now() ? "expired" : "completed",
          finishedAt: Date.now(),
        });
      }
      setNotice(`${title(id)} saved. One step closer.`);
      setView("home");
    } catch {
      setError(
        "The recording could not be saved. Please check browser storage before leaving this section.",
      );
    } finally {
      setBusy(false);
    }
  };
  const calculate = async (writing = true) => {
    const a = current.current;
    if (!a || !allFinished(a)) return;
    const generation = ++requestGeneration.current;
    setBusy(true);
    setView("results");
    setError("");
    try {
      const response = await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sections: a.sections,
          evaluateWriting: writing,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (
        generation === requestGeneration.current &&
        current.current?.id === a.id
      )
        write({
          ...current.current,
          results: {
            ...data,
            writing: data.writing || current.current.results?.writing,
          },
        } as Attempt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  };
  const doReset = async () => {
    setBusy(true);
    try {
      await stopRecording.current?.();
      await clearClips();
      localStorage.removeItem(STORAGE_KEY);
      requestGeneration.current++;
      if (test) write(freshAttempt(test) as Attempt);
      setLoadingError("");
      setNotice(
        "Saved answers, recordings, scores, and timers cleared. Ready for a fresh start.",
      );
      setView("home");
      setReset(false);
    } catch {
      setError("Could not clear saved test data. Close other tabs and retry.");
    } finally {
      setBusy(false);
    }
  };
  const section = test?.sections.find((s) => s.id === view);
  const active =
    attempt &&
    Object.entries(attempt.sections).find(([, s]) => s.status === "active");
  const complete = attempt
    ? Object.values(attempt.sections).filter(finished).length
    : 0;
  return (
    <>
      <header className="topbar">
        <button
          className="brand"
          onClick={() => {
            setView("home");
            setNotice("");
          }}
          aria-label="Baseline home"
        >
          <span className="brand-mark">
            b<span>.</span>
          </span>
          <span>
            baseline<span className="brand-sub">IELTS PRACTICE</span>
          </span>
        </button>
        <div className="header-right">
          <span className="local-dot" /> Saved on this device{" "}
          <span className="header-divider" />
          <span>General Training</span>
        </div>
      </header>
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="alert" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss notice">
            ×
          </button>
        </div>
      )}
      {!test || !attempt ? (
        <main className="shell">
          <h1>
            {loadingError
              ? "Let’s recover your test."
              : "Preparing your practice space…"}
          </h1>
          <p>{loadingError || "Loading the official sample question set."}</p>
          {test && (
            <button className="primary" onClick={() => setReset(true)}>
              Clear saved test data
            </button>
          )}
        </main>
      ) : view === "home" ? (
        <main className="shell home">
          <div className="eyebrow">
            <span className="eyebrow-line" /> YOUR STARTING POINT
          </div>
          <div className="hero-row">
            <div>
              <h1>
                A little practice.
                <br />
                <em>A clearer picture.</em>
              </h1>
              <p className="hero-description">
                Find your starting point with an IELTS General Training mock
                test.
                <br className="desktop" /> Four skills. Your pace between
                sections. A plan for what comes next.
              </p>
            </div>
            <div className="progress-seal">
              <svg viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="43" />
                <circle
                  className="ring"
                  cx="50"
                  cy="50"
                  r="43"
                  strokeDasharray={`${(complete / 4) * 270.2} 270.2`}
                />
              </svg>
              <span>
                <strong>
                  {complete}
                  <small> / 4</small>
                </strong>
                <small>SECTIONS FINISHED</small>
              </span>
            </div>
          </div>
          <section className="set-banner">
            <div className="set-icon">▧</div>
            <div>
              <span className="tiny-label">QUESTION SET 01</span>
              <strong>IELTS General Training samples</strong>
              <span className="muted">
                Official sample tasks, brought together in one practice session.
              </span>
            </div>
            <span className="pill">OFFICIAL MATERIAL</span>
          </section>
          <div className="section-heading">
            <h2>Choose a skill to begin</h2>
            <span>You can take sections in any order</span>
          </div>
          <div className="section-grid">
            {test.sections.map((s, i) => {
              const p = attempt.sections[s.id],
                done = finished(p),
                resume = p.status === "active";
              return (
                <article
                  className={`skill-card ${done ? "done" : ""}`}
                  key={s.id}
                >
                  <div className="card-top">
                    <span className={`skill-icon ${s.id}`}>{icons[s.id]}</span>
                    <span className="tiny-label">0{i + 1}</span>
                  </div>
                  <div className="card-title">
                    <h2>{s.title}</h2>
                    {done && <span className="done-check">✓</span>}
                  </div>
                  <p>{descriptions[s.id]}</p>
                  <div className="card-meta">
                    <span>◷ {s.minutes} min</span>
                    <span>
                      {s.id === "writing"
                        ? "2 tasks"
                        : s.id === "speaking"
                          ? `${s.questionCount} prompts`
                          : `${s.questionCount} questions`}
                    </span>
                  </div>
                  <button
                    className={
                      done ? "section-button complete" : "section-button"
                    }
                    disabled={done || (!!active && !resume)}
                    onClick={() => start(s)}
                  >
                    {done
                      ? p.status === "expired"
                        ? "Time ended · Saved"
                        : "Completed"
                      : resume
                        ? `Resume · ${time((p.deadline || now) - now)}`
                        : `Start ${s.title.toLowerCase()}`}
                    <span>{done ? "✓" : "↗"}</span>
                  </button>
                </article>
              );
            })}
          </div>
          <section className="results-strip">
            <div className="strip-icon">↗</div>
            <div>
              <h3>See where you stand.</h3>
              <p>
                Finish all four sections to unlock scores, feedback, and your
                recordings.
              </p>
            </div>
            <button
              className="primary"
              disabled={!allFinished(attempt) || busy}
              onClick={() =>
                attempt.results ? setView("results") : void calculate()
              }
            >
              Calculate scores <span>→</span>
            </button>
          </section>
          <div className="home-notes">
            <p>
              <span>ⓘ</span> Timers keep running if you close or refresh the
              page. Answers stay on this device.
            </p>
            <button className="text-button" onClick={() => setReset(true)}>
              ↺ Clear saved test data
            </button>
          </div>
          <div className="footnote">
            A combined sample set, not a full-length official exam. Reading and
            Listening show raw scores; Writing is an AI estimate.
            <br />
            Speaking uses your own assessment. Writing responses are sent to
            OpenAI only when you calculate scores.
            {!configured && <span> AI Writing setup needed — see README.</span>}
          </div>
        </main>
      ) : view === "results" ? (
        <Results
          test={test}
          attempt={attempt}
          busy={busy}
          calculate={calculate}
          home={() => setView("home")}
          updateScores={(scores) =>
            write({ ...current.current!, speakingScores: scores })
          }
        />
      ) : section ? (
        <TestScreen
          section={section}
          state={attempt.sections[section.id]}
          attemptId={attempt.id}
          now={now}
          busy={busy}
          onAnswer={(f, v) => saveAnswer(section.id, f, v)}
          onIndex={(index) => patchSection(section.id, { index })}
          finish={() => finish(section.id)}
          home={() => setView("home")}
          registerStop={(stop) => {
            stopRecording.current = stop;
          }}
          onError={setError}
          onAudio={(audio) => patchSection(section.id, { audio })}
        />
      ) : null}
      <footer>
        <span>
          baseline{" "}
          <span className="muted">
            / A small step toward your next chapter.
          </span>
        </span>
        <a
          href="https://ielts.org/take-a-test/preparation-resources/sample-test-questions/general-training-test"
          target="_blank"
          rel="noreferrer"
        >
          Source: IELTS.org ↗
        </a>
      </footer>
      {reset && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
          >
            <span className="eyebrow">FRESH START</span>
            <h2 id="reset-title">Clear this attempt?</h2>
            <p>
              This removes this app’s saved answers, microphone recordings,
              scores, and timers from this browser.
            </p>
            <div className="modal-actions">
              <button autoFocus onClick={() => setReset(false)} disabled={busy}>
                Keep my progress
              </button>
              <button
                className="danger"
                onClick={() => void doReset()}
                disabled={busy}
              >
                Clear test data
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function QuestionBody({
  task,
  answers,
  locked,
  onAnswer,
}: {
  task: Task;
  answers: SectionState["answers"];
  locked: boolean;
  onAnswer: (f: string, v: string | string[]) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const markup = useMemo(() => ({ __html: task.html }), [task.html]);
  const live = useRef({ locked, onAnswer });
  live.current = { locked, onAnswer };
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    el.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("[data-field]").forEach((input) => {
      const value = answers[input.dataset.field!] || "";
      if (
        input instanceof HTMLInputElement &&
        (input.type === "radio" || input.type === "checkbox")
      )
        input.checked = Array.isArray(value)
          ? value.includes(input.value)
          : input.value === value;
      else input.value = typeof value === "string" ? value : "";
    });
  }, [task.id, answers]);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const handler = (e: Event) => {
      const input = e.target as HTMLInputElement;
      if (!input.dataset.field || live.current.locked) return;
      if (input.type === "checkbox") {
        const f = task.fields.find((f) => f.id === input.dataset.field)!;
        const values = Array.from(
          el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
        )
          .filter((i) => i.dataset.field === f.id && i.checked)
          .map((i) => i.value);
        if (values.length > (f.max || 1)) {
          input.checked = false;
          return;
        }
        live.current.onAnswer(f.id, values);
      } else live.current.onAnswer(input.dataset.field, input.value);
    };
    el.addEventListener("input", handler);
    return () => el.removeEventListener("input", handler);
  }, [task.id]);
  return (
    <fieldset className="question-controls" disabled={locked}>
      <div
        ref={root}
        className="question-body"
        dangerouslySetInnerHTML={markup}
      />
    </fieldset>
  );
}

function ListeningPlayer({
  section,
  state,
  onProgress,
  locked,
  onTrackChange,
}: {
  section: Section;
  state: SectionState;
  onProgress: (a: NonNullable<SectionState["audio"]>) => void;
  locked: boolean;
  onTrackChange: (index: number) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null),
    [track, setTrack] = useState(state.audio?.track || 0),
    [started, setStarted] = useState(false),
    [complete, setComplete] = useState(state.audio?.ended || false),
    [failed, setFailed] = useState(false);
  const position = useRef(state.audio?.position || 0),
    lastSave = useRef(0),
    autoAdvance = useRef(false),
    progress = useRef(onProgress);
  progress.current = onProgress;
  useEffect(() => {
    if (locked) audio.current?.pause();
  }, [locked]);
  useEffect(
    () => () => {
      audio.current?.pause();
    },
    [],
  );
  const play = () => {
    setFailed(false);
    onTrackChange(track);
    audio.current
      ?.play()
      .then(() => setStarted(true))
      .catch(() => {
        setStarted(false);
        setFailed(true);
      });
  };
  return (
    <div className="audio-bar">
      <span className="audio-symbol">◉</span>
      <div>
        <strong>
          {complete
            ? "Listening audio complete"
            : `Audio for task ${track + 1} of ${section.tasks.length}`}
        </strong>
        <small>
          {complete
            ? "You may review your answers until you finish."
            : `${section.tasks[track].topic} · ${section.tasks[track].title}`}
        </small>
      </div>
      {!complete && (
        <button disabled={locked} onClick={play} className="small-button">
          {started ? "Playing…" : failed ? "Retry audio" : "Play audio"} ▷
        </button>
      )}
      {started && <span className="sound-wave">▂▅▃▇▂</span>}
      {!complete && state.index !== track && (
        <button
          className="small-button"
          onClick={() => onTrackChange(track)}
          disabled={locked}
        >
          Show task {track + 1} questions
        </button>
      )}
      <audio
        ref={audio}
        src={section.tasks[track].audio}
        preload="auto"
        onLoadedMetadata={() => {
          if (audio.current) audio.current.currentTime = position.current;
          if (autoAdvance.current && !locked) {
            autoAdvance.current = false;
            play();
          }
        }}
        onError={() => {
          setFailed(true);
          setStarted(false);
        }}
        onTimeUpdate={() => {
          const a = audio.current;
          if (a && Date.now() - lastSave.current > 1500) {
            lastSave.current = Date.now();
            progress.current({ track, position: a.currentTime, ended: false });
          }
        }}
        onEnded={() => {
          if (track < section.tasks.length - 1) {
            position.current = 0;
            autoAdvance.current = true;
            setTrack(track + 1);
            onTrackChange(track + 1);
            progress.current({ track: track + 1, position: 0, ended: false });
            setStarted(false);
          } else {
            setComplete(true);
            setStarted(false);
            progress.current({ track, position: 0, ended: true });
          }
        }}
      />
      {failed && (
        <small role="alert">
          Audio could not start. Check the local audio file, then retry.
        </small>
      )}
    </div>
  );
}

function Recorder({
  attemptId,
  taskId,
  locked,
  registerStop,
  onError,
}: {
  attemptId: string;
  taskId: string;
  locked: boolean;
  registerStop: (fn: null | (() => Promise<unknown>)) => void;
  onError: (s: string) => void;
}) {
  const [recording, setRecording] = useState(false),
    [pending, setPending] = useState(false),
    [saved, setSaved] = useState(false);
  const handle = useRef<Awaited<ReturnType<typeof record>> | null>(null),
    cancelled = useRef(false),
    lockedRef = useRef(locked);
  lockedRef.current = locked;
  const stop = async () => {
    const h = handle.current;
    if (h) {
      await h.stop();
      handle.current = null;
      setRecording(false);
      setSaved(true);
    }
  };
  useEffect(() => {
    cancelled.current = false;
    registerStop(stop);
    clipsFor(attemptId)
      .then((clips) => {
        if (!cancelled.current)
          setSaved(clips.some((c) => c.taskId === taskId));
      })
      .catch(() => onError("Could not access saved microphone recordings."));
    return () => {
      cancelled.current = true;
      registerStop(null);
      void handle.current?.stop().catch(() => {});
    };
  }, [taskId]);
  useEffect(() => {
    if (locked) void stop().catch(() => {});
  }, [locked]);
  const start = async () => {
    setPending(true);
    try {
      const h = await record(attemptId, taskId, onError);
      if (cancelled.current || lockedRef.current) {
        await h.stop();
        return;
      }
      handle.current = h;
      setRecording(true);
    } catch (e) {
      onError(
        (e as Error).name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access in your browser, then try again."
          : (e as Error).message,
      );
    } finally {
      if (!cancelled.current) setPending(false);
    }
  };
  return (
    <div className="recorder">
      <div className={`mic-orb ${recording ? "recording" : ""}`}>♬</div>
      <h3>
        {recording
          ? "Your voice, captured."
          : saved
            ? "Response saved."
            : "Make yourself heard."}
      </h3>
      <p>
        {recording
          ? "Recording locally. Continue to save this response."
          : saved
            ? "You can add another recording for this prompt."
            : "Your microphone stays on this device. Listen back after all sections are finished."}
      </p>
      <button
        className={recording ? "danger" : "primary"}
        disabled={locked || pending}
        onClick={() =>
          recording
            ? void stop().catch(() => onError("Could not save your recording."))
            : void start()
        }
      >
        {pending
          ? "Opening microphone…"
          : recording
            ? "■ Stop & save"
            : "● Record response"}
      </button>
      <small>
        {recording
          ? "Recording · saved every 3 seconds"
          : saved
            ? "✓ Recording saved in this browser"
            : "You can also continue without a recording."}
      </small>
    </div>
  );
}

function TestScreen({
  section,
  state,
  attemptId,
  now,
  busy,
  onAnswer,
  onIndex,
  finish,
  home,
  registerStop,
  onError,
  onAudio,
}: {
  section: Section;
  state: SectionState;
  attemptId: string;
  now: number;
  busy: boolean;
  onAnswer: (f: string, v: string | string[]) => void;
  onIndex: (i: number) => void;
  finish: () => Promise<void>;
  home: () => void;
  registerStop: (fn: null | (() => Promise<unknown>)) => void;
  onError: (e: string) => void;
  onAudio: (a: NonNullable<SectionState["audio"]>) => void;
}) {
  const task = section.tasks[state.index],
    locked = finished(state) || (state.deadline || 0) <= now;
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [navBusy, setNavBusy] = useState(false);
  const stop = useRef<null | (() => Promise<unknown>)>(null);
  const navigate = async (index: number) => {
    if (locked || navBusy) return;
    setNavBusy(true);
    try {
      await stop.current?.();
      onIndex(index);
      window.scrollTo(0, 0);
    } catch {
      onError(
        "Recording storage failed. Please save your recording before continuing.",
      );
    } finally {
      setNavBusy(false);
    }
  };
  const register = (fn: null | (() => Promise<unknown>)) => {
    stop.current = fn;
    registerStop(fn);
  };
  const goHome = async () => {
    try {
      await stop.current?.();
      home();
    } catch {
      onError("Recording could not be saved.");
    }
  };
  const answered = section.tasks
    .flatMap((t) => t.fields)
    .filter((f) => isAnswered(state.answers[f.id]))
    .reduce(
      (n, f) =>
        n +
        (f.type === "multi"
          ? Math.min((state.answers[f.id] as string[]).length, f.points)
          : 1),
      0,
    );
  return (
    <main className="exam-shell">
      <div className="exam-toolbar">
        <button className="text-button" onClick={() => void goHome()}>
          ← Dashboard
        </button>
        <div>
          <span className="tiny-label">
            GENERAL TRAINING / {section.title.toUpperCase()}
          </span>
          <h1>{section.title} practice</h1>
        </div>
        <div
          className={`timer ${(state.deadline || 0) - now < 300000 ? "urgent" : ""}`}
          role="timer"
          aria-label="Time remaining"
        >
          <small>TIME REMAINING</small>
          <strong>{time((state.deadline || 0) - now)}</strong>
        </div>
      </div>
      {section.id === "listening" && (
        <ListeningPlayer
          section={section}
          state={state}
          locked={locked}
          onProgress={onAudio}
          onTrackChange={onIndex}
        />
      )}
      <div className="exam-task-heading">
        <div>
          <span className="tiny-label">
            {section.id === "speaking" ? "PROMPT" : "TASK"} {state.index + 1} OF{" "}
            {section.tasks.length}
          </span>
          <h2>{task.title}</h2>
          {task.topic && <h3 className="task-topic">{task.topic}</h3>}
          <p>{task.instructions}</p>
        </div>
        <span className="pill">
          {section.id === "speaking"
            ? "MICROPHONE PRACTICE"
            : `${answered} / ${section.questionCount} answered`}
        </span>
      </div>
      <div
        className={`exam-columns ${!task.passage ? "single" : ""}`}
        key={task.id}
      >
        {task.passage && (
          <article className="passage-panel">
            <span className="tiny-label">
              {section.id === "reading"
                ? "READING PASSAGE"
                : section.id === "writing"
                  ? "YOUR TASK"
                  : "YOUR PROMPT"}
            </span>
            <div
              className="passage"
              dangerouslySetInnerHTML={{ __html: task.passage }}
            />
          </article>
        )}
        <section className="answer-panel">
          <span className="tiny-label">
            {section.id === "speaking" ? "YOUR RESPONSE" : "YOUR ANSWERS"}
          </span>
          {section.id === "speaking" ? (
            <Recorder
              attemptId={attemptId}
              taskId={task.id}
              locked={locked || navBusy}
              registerStop={register}
              onError={onError}
            />
          ) : (
            <QuestionBody
              task={task}
              answers={state.answers}
              locked={locked}
              onAnswer={onAnswer}
            />
          )}{" "}
          {section.id === "writing" && (
            <p className="word-count">
              {
                String(state.answers[task.fields[0].id] || "")
                  .trim()
                  .split(/\s+/)
                  .filter(Boolean).length
              }{" "}
              words · {state.index === 0 ? "150" : "250"} minimum
            </p>
          )}
        </section>
      </div>
      <div className="exam-bottom">
        <div className="question-nav" aria-label="Question navigation">
          {section.id === "speaking" ? (
            <span>
              Prompt {state.index + 1} of {section.tasks.length}
            </span>
          ) : (
            section.tasks.map((t, i) => (
              <button
                key={t.id}
                disabled={locked || navBusy}
                className={`${i === state.index ? "selected" : ""} ${t.fields.every((f) => isAnswered(state.answers[f.id])) ? "answered" : ""}`}
                onClick={() => void navigate(i)}
                aria-label={`Go to task ${i + 1}: ${t.title}`}
              >
                {i + 1}
              </button>
            ))
          )}
        </div>
        <div className="exam-actions">
          {section.id !== "speaking" && (
            <button
              disabled={state.index === 0 || locked || navBusy}
              onClick={() => void navigate(state.index - 1)}
            >
              ← Previous
            </button>
          )}
          {state.index < section.tasks.length - 1 ? (
            <button
              className="primary"
              disabled={locked || navBusy}
              onClick={() => void navigate(state.index + 1)}
            >
              Next {section.id === "speaking" ? "prompt" : "task"} →
            </button>
          ) : (
            <button
              className="primary"
              disabled={locked || busy || navBusy}
              onClick={() => setConfirmFinish(true)}
            >
              Finish section ✓
            </button>
          )}
        </div>
      </div>
      {state.index < section.tasks.length - 1 && section.id !== "speaking" && (
        <button
          className="text-button finish-early"
          disabled={locked || busy}
          onClick={() => setConfirmFinish(true)}
        >
          Finish section early
        </button>
      )}
      {confirmFinish && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="finish-title"
          >
            <h2 id="finish-title">Finish {section.title.toLowerCase()}?</h2>
            <p>
              Your answers will be saved and locked.
              {section.id !== "speaking" &&
                ` You answered ${answered} of ${section.questionCount} questions.`}{" "}
              The timer will stop.
            </p>
            <div className="modal-actions">
              <button
                autoFocus
                onClick={() => setConfirmFinish(false)}
                disabled={busy}
              >
                Keep working
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void finish()}
              >
                {busy ? "Saving…" : "Finish & save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ClipPlayer({ clip }: { clip: Clip }) {
  const url = useMemo(
    () => URL.createObjectURL(new Blob(clip.chunks, { type: clip.mime })),
    [clip],
  );
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <audio controls src={url} preload="metadata" />;
}
function Results({
  test,
  attempt,
  busy,
  calculate,
  home,
  updateScores,
}: {
  test: Test;
  attempt: Attempt;
  busy: boolean;
  calculate: (writing?: boolean) => Promise<void>;
  home: () => void;
  updateScores: (s: Record<string, string>) => void;
}) {
  const [clips, setClips] = useState<Clip[]>([]),
    [recordingError, setRecordingError] = useState("");
  useEffect(() => {
    clipsFor(attempt.id)
      .then(setClips)
      .catch(() => setRecordingError("Could not load saved recordings."));
  }, [attempt.id]);
  const result = attempt.results;
  const criteria = [
    ["fluency", "Fluency & coherence"],
    ["vocabulary", "Lexical resource"],
    ["grammar", "Grammatical range & accuracy"],
    ["pronunciation", "Pronunciation"],
  ];
  const entered = criteria.map(([k]) => attempt.speakingScores[k]);
  const speakingBand = entered.every((v) => v !== undefined && v !== "")
    ? Math.round((entered.reduce((n, v) => n + Number(v), 0) / 4) * 2) / 2
    : null;
  return (
    <main className="shell results">
      <button className="text-button" onClick={home}>
        ← Back to dashboard
      </button>
      <div className="eyebrow results-eyebrow">YOUR BASELINE</div>
      <h1>
        Now you know
        <br />
        <em>where to grow.</em>
      </h1>
      <p className="hero-description">
        A starting point for your next chapter. Every attempt is progress.
      </p>
      {busy && (
        <div className="evaluation-status" role="status">
          <span className="spinner" />
          <div>
            <strong>Reviewing your responses…</strong>
            <p>
              Writing is evaluated against official criteria and examiner
              examples. This can take a minute.
            </p>
          </div>
        </div>
      )}
      {!result && !busy && (
        <div className="alert">
          <p>Your answers are saved. Try calculating again.</p>
          <button onClick={() => void calculate()}>Retry calculation</button>
        </div>
      )}
      {result && (
        <>
          <div className="score-grid">
            {["reading", "listening"].map((id) => (
              <article className="score-card" key={id}>
                <span className="tiny-label">{id.toUpperCase()}</span>
                <div className="score-number">
                  {result[id].score}
                  <small> / {result[id].total}</small>
                </div>
                <p>{result[id].percentage}% correct · official answer key</p>
                <span className="pill">RAW SAMPLE SCORE</span>
              </article>
            ))}
            <article className="score-card">
              <span className="tiny-label">WRITING</span>
              <div className="score-number">
                {result.writing?.band ?? "—"}
                <small> / 9</small>
              </div>
              <p>
                {result.writing ? "AI-estimated band" : "Evaluation pending"}
              </p>
              <span className="pill">PRACTICE ESTIMATE</span>
            </article>
            <article className="score-card">
              <span className="tiny-label">SPEAKING</span>
              <div className="score-number">
                {speakingBand ?? "—"}
                <small> / 9</small>
              </div>
              <p>
                {speakingBand !== null
                  ? "Your self-assessed band"
                  : "Listen back and assess below"}
              </p>
              <span className="pill">SELF-ASSESSMENT</span>
            </article>
          </div>
          <p className="footnote">
            These samples have different question counts from a full exam. Raw
            Reading and Listening scores are not converted to official bands,
            and no overall IELTS band is calculated.
          </p>
          {result.writingError && (
            <div className="writing-error">
              <strong>Writing evaluation needs attention</strong>
              <p>{result.writingError}</p>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void calculate()}
              >
                Retry Writing evaluation
              </button>
            </div>
          )}
          {result.writing && (
            <section className="feedback-section">
              <div className="section-heading">
                <h2>Writing feedback</h2>
                <span>Task 2 carries twice the weight of Task 1</span>
              </div>
              {["task1", "task2"].map((key, i) => {
                const t = result.writing[key];
                const sourceTask = test.sections.find(
                  (s) => s.id === "writing",
                )!.tasks[i];
                return (
                  <article className="feedback-card" key={key}>
                    <div className="feedback-heading">
                      <h3>Task {i + 1}</h3>
                      <span className="band-chip">Estimated band {t.band}</span>
                    </div>
                    <details>
                      <summary>Your submitted response</summary>
                      <p className="submitted-text">
                        {attempt.sections.writing.answers[
                          sourceTask.fields[0].id
                        ] || "No answer submitted."}
                      </p>
                    </details>
                    <div className="criteria-grid">
                      {[
                        [
                          "taskResponse",
                          i === 0 ? "Task achievement" : "Task response",
                        ],
                        ["coherence", "Coherence & cohesion"],
                        ["vocabulary", "Lexical resource"],
                        ["grammar", "Grammar & accuracy"],
                      ].map(([k, label]) => (
                        <div key={k}>
                          <h4>
                            {label}
                            <span>{t[k].score} / 9</span>
                          </h4>
                          <p>{t[k].feedback}</p>
                        </div>
                      ))}
                    </div>
                    <div className="feedback-lists">
                      <div>
                        <h4>Keep doing</h4>
                        <ul>
                          {t.strengths.map((s: string, i: number) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4>Work on next</h4>
                        <ul>
                          {t.improvements.map((s: string, i: number) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
          <section className="feedback-section">
            <h2>Review your answers</h2>
            {["reading", "listening"].map((id) => (
              <details className="review-section" key={id}>
                <summary>
                  {title(id)}{" "}
                  <span>
                    {result[id].score} / {result[id].total} correct
                  </span>
                </summary>
                {result[id].review.map((r: any) => (
                  <div
                    className={`review-row ${r.score === r.total ? "correct" : "incorrect"}`}
                    key={`${r.taskId}-${r.number}`}
                  >
                    <span className="question-number">{r.number}</span>
                    <div>
                      <strong>
                        {r.topic ? `${r.topic} · ${r.title}` : r.title}
                      </strong>
                      <p>Your answer: {r.answer}</p>
                      <p className="muted">Key: {r.correct}</p>
                    </div>
                    <span>
                      {r.score} / {r.total}
                    </span>
                  </div>
                ))}
              </details>
            ))}
          </section>
          <section className="feedback-section">
            <div className="section-heading">
              <h2>Speaking · listen & reflect</h2>
              <a
                href="https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail"
                target="_blank"
                rel="noreferrer"
              >
                Official scoring criteria ↗
              </a>
            </div>
            <p className="muted">
              Listen for flow, vocabulary, grammar, and clear pronunciation.
              Enter a band for each criterion to save your self-assessment.
            </p>
            <div className="self-assessment">
              {criteria.map(([key, label]) => (
                <label key={key}>
                  {label}
                  <select
                    value={attempt.speakingScores[key] ?? ""}
                    onChange={(e) =>
                      updateScores({
                        ...attempt.speakingScores,
                        [key]: e.target.value,
                      })
                    }
                  >
                    <option value="">Choose a band</option>
                    {Array.from({ length: 19 }, (_, i) => i / 2).map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {recordingError && <p role="alert">{recordingError}</p>}
            {test.sections
              .find((s) => s.id === "speaking")!
              .tasks.map((task, i) => (
                <details className="recording-review" key={task.id}>
                  <summary>
                    {i + 1}. {task.title}
                    <span>
                      {clips.filter((c) => c.taskId === task.id).length}{" "}
                      recordings
                    </span>
                  </summary>
                  <div
                    className="passage"
                    dangerouslySetInnerHTML={{ __html: task.passage }}
                  />
                  {clips.some((c) => c.taskId === task.id) ? (
                    clips
                      .filter((c) => c.taskId === task.id)
                      .map((c) => <ClipPlayer clip={c} key={c.id} />)
                  ) : (
                    <p className="muted">
                      No microphone recording saved for this prompt.
                    </p>
                  )}
                </details>
              ))}
          </section>
        </>
      )}
      <div className="results-bottom">
        <p>Your progress stays saved until you clear test data.</p>
        <button className="primary" onClick={home}>
          Back to dashboard →
        </button>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
