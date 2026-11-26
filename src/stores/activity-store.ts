import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DelegationActivity } from '@/stores/comment-store';
import type { ToolCallContentItem, ActivityApprovalMode } from '@/lib/ai/types';
import { createTauriStorage } from '@/lib/tauri-storage';
import { emitWorkflowEvent } from '@/lib/automations/event-bus';
import { reportRehydrateError } from "@/lib/persist-rehydrate";

const MAX_COMPLETED_TASKS = 100;
const MAX_ACTIVITIES_PER_TASK = 200;
const TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type AgentTaskType = 'comment' | 'chat' | 'workflow';
export type AgentTaskStatus = 'running' | 'done' | 'error' | 'cancelled';

/**
 * Discriminates the three categories the orb's activity panel renders.
 * Existing persisted tasks (pre-v2) lack this field; the v1→v2 migration
 * backfills `'agent'` so they render with the unchanged agent treatment.
 */
export type AgentTaskKind = 'agent' | 'transcription' | 'recording' | 'automation';

export interface AgentTask {
  id: string;
  /**
   * Category discriminator. Defaults to `'agent'` for any task created via
   * `addTask` (and for legacy tasks rehydrated without it). Transcription and
   * recording lifecycle items set this explicitly.
   */
  kind: AgentTaskKind;
  type: AgentTaskType;
  label: string;
  status: AgentTaskStatus;
  sourceFile?: string;
  commentId?: string;
  documentId?: string;
  connectionProvider?: string;
  startedAt: number;
  completedAt?: number;
  activities: DelegationActivity[];
  partialOutput?: string;
  finalOutput?: string;
  thinkingOutput?: string;

  // --- transcription-job fields (kind === 'transcription') ---
  /** Source audio file being transcribed. */
  audioPath?: string;
  /** Output transcript note path, set when the job completes. */
  transcriptPath?: string;
  /** Whole-file transcription progress, an integer 0–100. */
  progress?: number;
  /** What the backend is doing with the file right now. Absent until the first progress event. */
  transcriptionStage?: 'loading' | 'decoding' | 'transcribing' | 'finishing';
  /** ms-epoch this RUN began (a re-run resets it; `startedAt` is when the card was created). */
  runStartedAt?: number;
  /**
   * Where the remaining-time estimate measures from: the moment and percent of
   * the first real progress, so model loading and decoding are not counted as
   * transcription speed.
   */
  progressAnchorAt?: number;
  progressAnchorPercent?: number;
  /**
   * The app quit (or crashed) while this job ran. Distinct from a failure:
   * nothing went wrong with the recording, and it can be retried at once.
   */
  interrupted?: boolean;
  /** Separate microphone / system-audio files of a two-track recording, kept so a re-run labels speakers too. */
  tracks?: Array<{ role: 'mic' | 'system'; path: string }>;

  // --- recording-item fields (kind === 'recording' / 'transcription') ---
  /** ms-epoch when capture began, for the live elapsed-time affordance. */
  recordingStartedAt?: number;
  /** ms-epoch when capture stopped (carried onto the transcription job). */
  recordingStoppedAt?: number;
  /** Recorded length in seconds, pause-aware (carried onto the transcription job). */
  recordingDurationSecs?: number;

  /**
   * Set on a completed transcription job once its bundle has been relocated
   * into a project (kind === 'transcription'). When true, the "Move to project"
   * action is hidden — the bundle has already been filed.
   */
  moved?: boolean;

  /**
   * Whisper language code (e.g. `'sv'`, `'auto'`). For `kind === 'recording'`
   * this is the per-recording override picked on the live item, defaulting to
   * `recording-store.speechLanguage` when unset. For `kind === 'transcription'`
   * this is the language actually used for the run, carried forward so a
   * re-run reuses it without re-prompting.
   */
  language?: string;

  /**
   * Where the recording came from when it was not this Mac — the phone's
   * device label from the bundle's `recording.json` (`kind === 'transcription'`).
   * The card captions it *from Peter's iPhone*; absent for the Mac's own
   * recordings.
   */
  sourceDevice?: string;

  /**
   * Why the job failed, verbatim from the thrown error (`kind === 'transcription'`,
   * `status === 'error'`). Written back into the bundle manifest so the phone
   * can show it; the toast already shows it on the Mac.
   */
  errorMessage?: string;

  /**
   * The language Whisper reports it actually decoded (`kind === 'transcription'`).
   *
   * Distinct from `language` above, which is what the run *asked* for. When
   * that request was `'auto'`, this is the only record of what the model
   * decided — and a wrong decision is the difference between a transcript and
   * a page of nonsense, so it is worth showing rather than leaving the user to
   * wonder why the text is gibberish.
   */
  detectedLanguage?: string;
}

interface ActivityStore {
  tasks: AgentTask[];

  /**
   * Add an agent task. `kind` is optional and defaults to `'agent'`, keeping
   * existing call sites byte-identical in behavior.
   */
  addTask(task: Omit<AgentTask, 'activities' | 'startedAt' | 'kind'> & { kind?: AgentTaskKind }): void;
  removeTask(id: string): void;

  // --- transcription job lifecycle (kind === 'transcription') ---
  /** Create a running transcription job for a finalized audio file. */
  addTranscriptionJob(job: {
    id: string;
    label: string;
    audioPath: string;
    documentId?: string;
    /** ms-epoch the recording started (for the start–stop · length info row). */
    recordingStartedAt?: number;
    /** ms-epoch the recording stopped. */
    recordingStoppedAt?: number;
    /** Recorded length in seconds (pause-aware). */
    recordingDurationSecs?: number;
    /** Whisper language code actually used for this run. */
    language?: string;
    /** Device label of the recorder when it was not this Mac. */
    sourceDevice?: string;
    /** Separate tracks of a two-track recording. */
    tracks?: Array<{ role: 'mic' | 'system'; path: string }>;
  }): void;
  /**
   * Update a transcription job's progress (integer 0–100) and stage. A no-op,
   * with no new `tasks` array, when neither changed: progress events arrive
   * in bursts and every store write wakes every subscriber.
   */
  setTranscriptionProgress(id: string, percent: number, stage?: AgentTask['transcriptionStage']): void;
  /**
   * Mark a transcription job as cancelled by the user. Not a failure: the
   * recording goes back to "Not transcribed".
   */
  setTranscriptionCancelled(id: string): void;
  /** Rename a transcription job's card (the recording was renamed). */
  setTranscriptionLabel(id: string, label: string): void;
  /** Mark a transcription job done and record the output transcript path. */
  setTranscriptionDone(id: string, transcriptPath: string, detectedLanguage?: string): void;
  /** Mark a transcription job as failed (it can be retried from Recordings), keeping the error text. */
  setTranscriptionError(id: string, errorMessage?: string): void;
  /**
   * Record that a completed transcription job's bundle has been moved into a
   * project. Sets `moved: true` (hides the "Move to project" action) and
   * repoints `transcriptPath` at the relocated note so click-to-open still
   * resolves. `newAudioPath`, when given, repoints `audioPath` too — the
   * bundle move relocates the audio file as well, and without this the
   * retained `audioPath` kept pointing at the now-deleted inbox location.
   * No-op if the job is not a transcription.
   */
  setTranscriptionMoved(id: string, newTranscriptPath: string, newAudioPath?: string): void;
  /**
   * Flip a finished (`done` or `error`) transcription job back to `running`
   * with progress reset to 0, for the "re-run transcription with a different
   * model" action. Updates the existing task in place — does NOT create a new
   * entry — so the card stays the same list item across the re-run.
   */
  resetTranscriptionForRerun(id: string): void;

  // --- recording item lifecycle (kind === 'recording') ---
  /** Create a running recording item representing live capture. */
  addRecordingItem(item: { id: string; label: string; recordingStartedAt?: number }): void;
  /**
   * Set the per-recording language override on a live recording item. No-op
   * if `id` doesn't match a `kind === 'recording'` task.
   */
  setRecordingLanguage(id: string, language: string): void;
  /** Remove a recording item (e.g. when it transitions to a transcription job). */
  removeRecordingItem(id: string): void;
  resetTaskForContinuation(id: string): void;
  updateTaskStatus(id: string, status: AgentTaskStatus): void;
  appendActivity(id: string, activity: DelegationActivity): void;
  /**
   * Replace the `content` array on the most recent running tool-call activity
   * (or the most recent activity overall if none are running). Per ACP spec,
   * `tool_call_update.content` is a full replacement — callers should not merge.
   */
  setLastActivityContent(id: string, content: ToolCallContentItem[]): void;
  /**
   * Patch the `approvalMode` on the most recent running tool-call activity
   * (or the most recent activity overall). Used when a permission decision
   * arrives after the `tool_call` event has already created the activity.
   */
  setLastActivityApprovalMode(id: string, mode: ActivityApprovalMode): void;
  completeLastActivity(id: string): void;
  completeAllActivities(id: string): void;
  appendPartialOutput(id: string, chunk: string): void;
  appendThinkingOutput(id: string, chunk: string): void;
  setFinalOutput(id: string, output: string): void;
  clearCompleted(): void;
}

export const useActivityStore = create<ActivityStore>()(
  persist(
    (set, get) => ({
      tasks: [],

      addTask: (partial) => {
        const task: AgentTask = {
          kind: 'agent',
          ...partial,
          activities: [],
          startedAt: Date.now(),
        };
        set((state) => {
          const updated = [task, ...state.tasks];
          // Prune oldest completed tasks if over the limit
          const completed = updated.filter((t) => t.status !== 'running');
          if (completed.length > MAX_COMPLETED_TASKS) {
            const toRemove = new Set(
              completed
                .slice(MAX_COMPLETED_TASKS)
                .map((t) => t.id)
            );
            return { tasks: updated.filter((t) => !toRemove.has(t.id)) };
          }
          return { tasks: updated };
        });
      },

      removeTask: (id) => {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.id !== id),
        }));
      },

      addTranscriptionJob: ({
        id,
        label,
        audioPath,
        documentId,
        recordingStartedAt,
        recordingStoppedAt,
        recordingDurationSecs,
        language,
        sourceDevice,
        tracks,
      }) => {
        const now = Date.now();
        const task: AgentTask = {
          id,
          kind: 'transcription',
          type: 'workflow',
          label,
          status: 'running',
          audioPath,
          documentId,
          recordingStartedAt,
          recordingStoppedAt,
          recordingDurationSecs,
          language,
          sourceDevice,
          ...(tracks && tracks.length > 0 ? { tracks } : {}),
          progress: 0,
          activities: [],
          startedAt: now,
          runStartedAt: now,
        };
        set((state) => {
          const updated = [task, ...state.tasks];
          const completed = updated.filter((t) => t.status !== 'running');
          if (completed.length > MAX_COMPLETED_TASKS) {
            const toRemove = new Set(
              completed.slice(MAX_COMPLETED_TASKS).map((t) => t.id)
            );
            return { tasks: updated.filter((t) => !toRemove.has(t.id)) };
          }
          return { tasks: updated };
        });
      },

      setTranscriptionProgress: (id, percent, stage) => {
        const clamped = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
        const current = get().tasks.find((t) => t.id === id);
        if (!current) return;
        const nextStage = stage ?? current.transcriptionStage;
        // Checked BEFORE `set`, not inside it: an unchanged event must not
        // reach the store at all. `set` would notify nobody for an identical
        // state, but the persist middleware writes to disk on every call.
        if (current.progress === clamped && current.transcriptionStage === nextStage) return;
        const anchor =
          current.progressAnchorAt === undefined && clamped > 0 && (nextStage ?? 'transcribing') === 'transcribing'
            ? { progressAnchorAt: Date.now(), progressAnchorPercent: clamped }
            : {};
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, progress: clamped, transcriptionStage: nextStage, ...anchor } : t
          ),
        }));
      },

      setTranscriptionCancelled: (id) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id && t.kind === 'transcription'
              ? {
                  ...t,
                  status: 'cancelled' as const,
                  completedAt: Date.now(),
                  errorMessage: undefined,
                  transcriptionStage: undefined,
                }
              : t
          ),
        }));
      },

      setTranscriptionLabel: (id, label) => {
        const current = get().tasks.find((t) => t.id === id);
        if (!current || current.kind !== 'transcription' || current.label === label) return;
        set((state) => ({ tasks: state.tasks.map((t) => (t.id === id ? { ...t, label } : t)) }));
      },

      setTranscriptionDone: (id, transcriptPath, detectedLanguage) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: 'done' as const,
                  progress: 100,
                  transcriptPath,
                  detectedLanguage,
                  transcriptionStage: undefined,
                  completedAt: Date.now(),
                }
              : t
          ),
        }));
      },

      setTranscriptionError: (id, errorMessage) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id
              ? { ...t, status: 'error' as const, completedAt: Date.now(), errorMessage, transcriptionStage: undefined }
              : t
          ),
        }));
      },

      setTranscriptionMoved: (id, newTranscriptPath, newAudioPath) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id && t.kind === 'transcription'
              ? {
                  ...t,
                  moved: true,
                  transcriptPath: newTranscriptPath,
                  audioPath: newAudioPath ?? t.audioPath,
                }
              : t
          ),
        }));
      },

      resetTranscriptionForRerun: (id) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id && t.kind === 'transcription'
              ? {
                  ...t,
                  status: 'running' as const,
                  progress: 0,
                  completedAt: undefined,
                  errorMessage: undefined,
                  interrupted: undefined,
                  transcriptionStage: undefined,
                  progressAnchorAt: undefined,
                  progressAnchorPercent: undefined,
                  runStartedAt: Date.now(),
                }
              : t
          ),
        }));
      },

      setRecordingLanguage: (id, language) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id && t.kind === 'recording' ? { ...t, language } : t
          ),
        }));
      },

      addRecordingItem: ({ id, label, recordingStartedAt }) => {
        const task: AgentTask = {
          id,
          kind: 'recording',
          type: 'workflow',
          label,
          status: 'running',
          recordingStartedAt: recordingStartedAt ?? Date.now(),
          activities: [],
          startedAt: Date.now(),
        };
        set((state) => ({ tasks: [task, ...state.tasks] }));
      },

      removeRecordingItem: (id) => {
        set((state) => ({
          tasks: state.tasks.filter((t) => !(t.id === id && t.kind === 'recording')),
        }));
      },

      resetTaskForContinuation: (id) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: 'running' as const,
                  partialOutput: undefined,
                  finalOutput: undefined,
                  thinkingOutput: undefined,
                  completedAt: undefined,
                }
              : t
          ),
        }));
      },

      updateTaskStatus: (id, status) => {
        let completed: AgentTask | undefined;
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id) return t;
            const next = { ...t, status, completedAt: status !== 'running' ? Date.now() : t.completedAt };
            if (status === 'done') completed = next;
            return next;
          }),
        }));
        // Phase 3: surface agent-task-complete for genuine agent tasks ONLY —
        // never kind:'automation' (an automation run must not self-trigger an
        // agent-done automation), nor transcription/recording.
        if (completed?.kind === 'agent') {
          emitWorkflowEvent({
            event: 'agent-task-complete',
            taskId: id,
            label: completed.label,
            output: completed.finalOutput,
          });
        }
      },

      appendActivity: (id, activity) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id) return t;
            let activities = [...t.activities, activity];
            // Trim oldest activities if over the limit
            if (activities.length > MAX_ACTIVITIES_PER_TASK) {
              activities = activities.slice(activities.length - MAX_ACTIVITIES_PER_TASK);
            }
            return { ...t, activities };
          }),
        }));
      },

      completeLastActivity: (id) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id) return t;
            const updated = [...t.activities];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].status === 'running') {
                updated[i] = { ...updated[i], status: 'done' };
                break;
              }
            }
            return { ...t, activities: updated };
          }),
        }));
      },

      setLastActivityContent: (id, content) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id || t.activities.length === 0) return t;
            const updated = [...t.activities];
            let targetIdx = -1;
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].status === 'running') { targetIdx = i; break; }
            }
            if (targetIdx === -1) targetIdx = updated.length - 1;
            updated[targetIdx] = { ...updated[targetIdx], content };
            return { ...t, activities: updated };
          }),
        }));
      },

      setLastActivityApprovalMode: (id, mode) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id || t.activities.length === 0) return t;
            const updated = [...t.activities];
            let targetIdx = -1;
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].status === 'running') { targetIdx = i; break; }
            }
            if (targetIdx === -1) targetIdx = updated.length - 1;
            updated[targetIdx] = { ...updated[targetIdx], approvalMode: mode };
            return { ...t, activities: updated };
          }),
        }));
      },

      completeAllActivities: (id) => {
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id) return t;
            const updated = t.activities.map((a) =>
              a.status === 'running' ? { ...a, status: 'done' as const } : a
            );
            return { ...t, activities: updated };
          }),
        }));
      },

      appendPartialOutput: (id, chunk) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, partialOutput: (t.partialOutput ?? '') + chunk } : t
          ),
        }));
      },

      appendThinkingOutput: (id, chunk) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, thinkingOutput: (t.thinkingOutput ?? '') + chunk } : t
          ),
        }));
      },

      setFinalOutput: (id, output) => {
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, finalOutput: output, partialOutput: undefined } : t
          ),
        }));
      },

      clearCompleted: () => {
        set((state) => ({
          tasks: state.tasks.filter((t) => t.status === 'running'),
        }));
      },
    }),
    {
      name: 'notesage-activity',
      storage: createTauriStorage(),
      version: 2,
      // v1 → v2: the `kind` discriminator was introduced for the meeting-recording
      // feature. Backfill `kind: 'agent'` on any persisted task that predates it
      // so existing tasks keep the unchanged agent rendering. Idempotent — leaves
      // tasks that already carry a `kind` untouched.
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as { tasks?: AgentTask[] } | undefined;
        if (state && Array.isArray(state.tasks) && version < 2) {
          state.tasks = state.tasks.map((t) =>
            t.kind ? t : { ...t, kind: 'agent' as const }
          );
        }
        return state as ActivityStore;
      },
      // Exclude transient streaming fields from persistence to avoid
      // excessive writes during token-by-token streaming updates.
      // `recording` items represent live in-progress capture — they are never
      // resumable across a restart, and persisting one would leave a stale
      // errored "Recording" entry after a crash mid-capture. Strip them here
      // (transcription + agent tasks stay persisted).
      partialize: (state) => ({
        ...state,
        tasks: state.tasks
          .filter((t) => t.kind !== 'recording')
          .map((t) => ({
            ...t,
            partialOutput: '',
            thinkingOutput: '',
          })),
      }),
      // On rehydration, mark any previously-running tasks as interrupted
      // and clear transient streaming state
      onRehydrateStorage: () => (state, error) => {
        if (error) reportRehydrateError("notesage-activity", error);
        if (!state) return;
        const now = Date.now();
        state.tasks = state.tasks
          // Defensive backfill: any task missing the `kind` discriminator
          // (legacy persisted state that bypassed the v1→v2 migrate path)
          // defaults to 'agent' so it renders unchanged.
          .map((t) => (t.kind ? t : { ...t, kind: 'agent' as const }))
          .map((t) => {
            if (t.status === 'running' && t.kind === 'transcription') {
              // The job died with the app. That is not a failed transcription:
              // the audio is untouched and the run can start again at once, so
              // it is marked interrupted (the card and the Recordings row say
              // so and offer the retry) and carries no stale progress.
              return {
                ...t,
                status: 'error' as const,
                interrupted: true,
                completedAt: now,
                progress: 0,
                transcriptionStage: undefined,
                progressAnchorAt: undefined,
                progressAnchorPercent: undefined,
                errorMessage: undefined,
              };
            }
            if (t.status === 'running') {
              return {
                ...t,
                status: 'error' as const,
                completedAt: now,
                partialOutput: undefined,
                finalOutput: t.partialOutput || t.finalOutput || undefined,
                activities: t.activities.map((a) =>
                  a.status === 'running' ? { ...a, status: 'error' as const } : a
                ),
              };
            }
            // Clear any leftover partialOutput on completed tasks
            if (t.partialOutput) {
              return { ...t, partialOutput: undefined };
            }
            return t;
          })
          // Remove completed tasks older than 7 days
          .filter((t) => {
            if (t.status === 'running') return true;
            if (t.completedAt && now - t.completedAt > TASK_TTL_MS) return false;
            return true;
          });
      },
    },
  ),
);
