# Baseline — IELTS General Training practice

A local mock-test app combining the tasks in IELTS.org's **General Training – sample tasks** section. No account or database server is needed. Git is initialized.

## Run

Requires Node.js **22.9 or later** and npm.

```powershell
npm install
Copy-Item .env.example .env
# Edit .env and set OPENAI_API_KEY to your own OpenAI API key.
npm run dev
```

Open **http://localhost:3000**. The app binds only to your computer's loopback interface. Keep the same URL/port/browser to retain saved progress.

`OPENAI_MODEL` defaults to `gpt-4.1` and can be changed to a Responses API model supporting structured outputs. The API key is used only by the local backend and is excluded from Git. Never put it in a `VITE_` environment variable. Restart the server after editing `.env`. API usage is billed by your OpenAI account.

Without a key, the test and objective scoring still work. The results page explains the missing Writing setup and offers a retry. No live API request was needed for automated tests.

For a production build:

```powershell
npm run build
npm start
```

Both modes use port 3000 by default (`PORT` in `.env` overrides it). Do not expose this personal local server to the public internet.

## Test behavior

- Reading: **34 questions / 60 minutes**, combining seven sample groups.
- Writing: **two tasks / 60 minutes**, with a word counter.
- Listening: **33 questions / 30 minutes**, combining eight sample groups with locally saved official audio and a map.
- Speaking: **14 prompts / 20 minutes**, including the Part 2 task card and follow-up questions. The 20-minute practice limit is user-selected; the official Speaking test is shorter.
- Sections can be started in any order. Finish an active section before starting another. Reading, Writing, and Listening allow moving between tasks, in line with computer-based test navigation. Speaking proceeds through prompts in order.
- A section starts its timer immediately. Answers save on change. A saved absolute deadline survives navigation, refresh, and browser closure. Expiry locks further input, saves current progress, and returns to the dashboard. A finished section cannot be reopened until the attempt is reset.
- Use **Finish section** to submit; typing the last answer does not automatically submit, so you can review or continue editing before time expires. You may submit with blanks.
- Listening audio plays once through a sequence of eight recordings, without pause or seek controls. Click Play audio to begin. On refresh or dashboard navigation, browser playback is interrupted; it resumes from the last saved playback position when you click Play again (the section timer continues throughout). Each group is independently recorded, so this is a sample compilation rather than one authentic full-test recording.
- Speaking asks for microphone permission when you click Record response. Chunks save to IndexedDB every three seconds; Stop, Next, Finish, and timeout also save the final chunk and release the microphone. If you refresh mid-recording, already-saved chunks remain; the last partial chunk may be lost. Recording must be started again for a new take. Current Chrome, Edge, or Firefox on localhost is recommended.
- Speaking recordings become playable in the results phase. Score the four Speaking criteria yourself there; your self-assessment is saved.
- Clearing test data removes only this app's answers, timers, scores, and recordings. It does not clear unrelated browser storage. This first version retains one attempt at a time, without longitudinal history.

## Scores and AI evaluation

**Calculate scores** unlocks once all four sections are completed or timed out. Reading and Listening are matched against the official answer-key PDFs on the local backend. Matching normalizes capitalization, surrounding/repeated whitespace, and hyphenation, accepts the variants shown in the keys, and handles unordered multi-answer questions without duplicate credit. Sample question counts differ from a full 40-question test, so these results show **raw scores and percentages**, not invented band conversions or an overall IELTS band.

Writing responses are sent to **OpenAI only when Calculate scores or Retry Writing evaluation is clicked**. Audio is never sent to OpenAI. The Responses API uses `store: false` and a strict JSON output schema. The grading prompt includes the actual tasks and official sample scripts/examiner comments, evaluates task achievement/response, coherence, vocabulary, and grammar, and weights Task 2 twice as much as Task 1. Displayed bands and feedback are **AI practice estimates, not official IELTS examiner results**. API failures preserve objective scores and allow retrying. Successful feedback stays in browser storage, avoiding repeated evaluation when revisiting results.

## Content and provenance

Source: https://ielts.org/take-a-test/preparation-resources/sample-test-questions/general-training-test

`data/sources.json` records source URLs and the import date. All seven Reading groups, all eight Listening groups, the two computer Writing tasks, the Speaking task card, the Part 1/3 examiner prompts, and Part 2 rounding-off questions are included. The alternative **Writing on Paper** links are excluded because this app captures typed responses. Candidate transcripts and example answers are excluded from test screens.

The public sample player provides question content via its read-only `GetQuestionSet` endpoint. The standalone keys were extracted from the linked official PDFs and transcribed into `data/keys.json`, including published alternative forms. Locally saved audio avoids expiring media URLs. Source PDF files and extracted text remain under `data/raw`; these, answer keys, and examiner references are never served as static files. The importer removes scorer-only rubric blocks from question markup and allowlists the HTML it renders.

The app is an independent personal practice tool, not an official IELTS product. IELTS owns the original practice materials. British Council crawling and additional question sets are future work; the question-set JSON is separate from the UI to support that expansion.

Task headings use the question format declared in the imported task metadata and show the corresponding passage or audio topic. Two Reading link labels on the source page differ from their task metadata: the City Media accident insurance questions are sentence completion, and the City Media internship questions are note completion. The app uses those content-matched labels while retaining the original source URLs, question IDs, and answer keys. Listening identifies the task for the current audio, opens its questions when playback starts or advances, and offers a link back to those questions if you browse another task.

### Refresh imported content (maintainer workflow)

The checked-in content runs without crawling. To refresh it, run `npm run import:samples`, then `node scripts/download-media.mjs`. Extract PDF text with Python/pypdf (the existing `.txt` files show the format), manually reconcile any answer-key changes in `data/keys.json`, and run `node scripts/prepare-content.mjs`. Review changed prompts and media before committing. The import scripts need internet access; the app does not fetch IELTS content during a test.

## Validation

```powershell
npm run build
npm test
```

Tests check question inventory, field rendering, local media, all-correct and blank objective scores, variants and duplicate answers, persistent deadlines, Writing schema validation and weighted scoring, mocked API requests/failures, completion gating, origin checks, private-file access, and production audio range requests.

API reference: https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses
