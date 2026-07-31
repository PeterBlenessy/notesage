// Task set for the local agentic evaluation.
//
// These measure the things that actually decide whether a local model is usable
// as an agent, which benchmark scores and parameter counts do not tell you:
// does it pick the right tool, does it get the arguments right, does it decline
// to invent a tool it wasn't given, and can it carry a second step.
//
// Each task is scored from the model's TOOL CALLS rather than its prose. Prose
// is where a small model looks competent while doing nothing; the tool call is
// the observable behaviour the agent loop depends on.

export interface EvalTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallObservation {
  name: string;
  arguments: Record<string, unknown>;
}

export interface EvalTask {
  id: string;
  /** What competence this probes, for the report. */
  probes: string;
  prompt: string;
  tools: EvalTool[];
  /** Optional pre-supplied tool result, for multi-step tasks. */
  followUpResult?: string;
  /** Passes when the observed calls are correct. */
  check: (calls: ToolCallObservation[]) => boolean;
}

function fn(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): EvalTool {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  };
}

const READ_FILE = fn(
  'read_file',
  'Read the contents of a file from disk',
  { path: { type: 'string', description: 'Absolute path to the file' } },
  ['path'],
);

const LIST_DIRECTORY = fn(
  'list_directory',
  'List the files in a directory',
  { path: { type: 'string', description: 'Absolute path to the directory' } },
  ['path'],
);

const WRITE_FILE = fn(
  'write_file',
  'Write content to a file, creating or overwriting it',
  {
    path: { type: 'string', description: 'Absolute path to the file' },
    content: { type: 'string', description: 'Content to write' },
  },
  ['path', 'content'],
);

const WEB_SEARCH = fn(
  'web_search',
  'Search the web for information',
  { query: { type: 'string', description: 'Search query' } },
  ['query'],
);

const only = (calls: ToolCallObservation[], name: string) =>
  calls.length > 0 && calls[0].name === name;

export const EVAL_TASKS: EvalTask[] = [
  {
    id: 'single-tool',
    probes: 'Calls a tool at all, with the right name',
    prompt: 'Read the file /workspace/config.json and tell me what is in it.',
    tools: [READ_FILE],
    check: (calls) => only(calls, 'read_file'),
  },
  {
    id: 'argument-accuracy',
    probes: 'Passes the exact argument rather than approximating it',
    prompt: 'Read the file at /workspace/deep/nested/notes-2026.md please.',
    tools: [READ_FILE],
    check: (calls) =>
      only(calls, 'read_file') &&
      calls[0].arguments.path === '/workspace/deep/nested/notes-2026.md',
  },
  {
    id: 'tool-selection',
    probes: 'Picks the right tool when plausible distractors are present',
    prompt: 'What files are in the /workspace/src directory?',
    tools: [READ_FILE, LIST_DIRECTORY, WRITE_FILE, WEB_SEARCH],
    check: (calls) => only(calls, 'list_directory'),
  },
  {
    id: 'write-with-two-args',
    probes: 'Fills every required argument, not just the first',
    prompt: 'Create /workspace/hello.txt containing exactly: hello world',
    tools: [WRITE_FILE],
    check: (calls) =>
      only(calls, 'write_file') &&
      calls[0].arguments.path === '/workspace/hello.txt' &&
      String(calls[0].arguments.content ?? '').includes('hello world'),
  },
  {
    id: 'no-hallucinated-tool',
    probes: 'Does not invent a capability it was not given',
    // Only read_file is offered; deleting is impossible. A model that invents
    // delete_file would, in the real loop, produce an unresolvable call.
    prompt: 'Delete the file /workspace/old.txt.',
    tools: [READ_FILE],
    check: (calls) => calls.every((c) => c.name === 'read_file'),
  },
  {
    id: 'second-step',
    probes: 'Carries a multi-step task past the first tool result',
    prompt: 'Look at /workspace/a.txt, then write its contents to /workspace/b.txt.',
    tools: [READ_FILE, WRITE_FILE],
    followUpResult: 'the contents of a.txt are: alpha beta gamma',
    // After the read result comes back, a capable agent writes. Scored across
    // both turns, so ordering is what matters, not the count.
    check: (calls) =>
      calls.some((c) => c.name === 'read_file') && calls.some((c) => c.name === 'write_file'),
  },
];
