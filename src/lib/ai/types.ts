export type AIProviderType = 'anthropic' | 'openai' | 'ollama' | 'google' | 'openai_compatible' | 'local_bundled';

export interface Citation {
  url: string;
  title: string;
  citedText: string;
}

/**
 * Approval mode for a tool invocation — recorded on the activity so the
 * user has a visible trail of *how* a tool call was authorized.
 *
 * - `'auto'`: auto-approved by the built-in auto-allow list (read-only tools)
 *             or by a persisted/session "always allow" grant.
 * - `'user'`: explicitly approved by the user via a permission card.
 * - `'denied'`: blocked by path filter, by the user's deny action, or by
 *               `requireAllToolConfirmations` being on and the user denying.
 *
 * When `undefined` (legacy activities), the UI falls back to no badge.
 */
export type ActivityApprovalMode = 'auto' | 'user' | 'denied';

/**
 * Known `kind` values for `AgentActivity`. The field is an open string for
 * backward compatibility with old messages, but new callers should use one
 * of these tokens so the renderer can switch on them.
 *
 * - `'tool_call'`: tool invocation by the assistant (see ActivityLog).
 * - `'attachment'`: a file path the user attached to a send (task #30). Logged
 *    on the USER message so every send has a visible trail of what was
 *    shared with the provider. `label` is the basename for the strip; `detail`
 *    is the full path for tooltip + debugging.
 */
export type AgentActivityKind = 'tool_call' | 'attachment' | string;

export interface AgentActivity {
  kind: AgentActivityKind;
  label: string;
  detail?: string;
  status: 'running' | 'done';
  timestamp: number;
  /** How this tool call was authorized. Optional for backward compat with old messages. */
  approvalMode?: ActivityApprovalMode;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  is_error: boolean;
}

export type ToolCallStatus = 'pending' | 'running' | 'complete' | 'error' | 'denied';

export interface ToolCallActivity {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: ToolCallStatus;
  result?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  /** How this tool call was authorized (auto / user / denied). */
  approvalMode?: ActivityApprovalMode;
}

export interface ImageAttachment {
  /** Unique ID for React keys and removal */
  id: string;
  /** Base64-encoded image data (after compression) */
  data: string;
  /** MIME type: "image/jpeg" | "image/png" | "image/gif" | "image/webp" */
  mimeType: string;
  /** Display width in pixels (post-compression) */
  width: number;
  /** Display height in pixels (post-compression) */
  height: number;
  /** Original filename if from file picker/drop, undefined if from paste */
  name?: string;
  /** Base64 byte size (for UI display, e.g. "340 KB") */
  size: number;
}

export type SystemStatusType = 'reconnecting' | 'reconnected' | 'failed';

// ---------------------------------------------------------------------------
// Message segments — chronological blocks within an assistant message
// ---------------------------------------------------------------------------

interface MessageSegmentBase {
  type: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'image' | 'plan';
  timestamp: number;
}

export interface TextSegment extends MessageSegmentBase {
  type: 'text';
  content: string;
}

export interface ThinkingSegment extends MessageSegmentBase {
  type: 'thinking';
  content: string;
  collapsed: boolean;
}

/**
 * Rich content items carried by ACP `tool_call_update` events.
 * Maps from the ACP `ToolCallContent` discriminated union (Content/Diff/Terminal).
 */
export type ToolCallContentItem =
  | { type: 'text'; text: string }
  | { type: 'diff'; path: string; oldText?: string; newText: string }
  | { type: 'terminal'; terminalId: string };

export interface ToolCallSegment extends MessageSegmentBase {
  type: 'tool_call';
  kind: string;
  label: string;
  detail?: string;
  status: 'running' | 'done' | 'error';
  locations?: { path: string; line?: number }[];
  /** Rich content from ACP tool_call_update (diffs, text, terminal refs). Full replacement per update. */
  content?: ToolCallContentItem[];
}

export interface ToolResultSegment extends MessageSegmentBase {
  type: 'tool_result';
  toolCallId?: string;
  result?: string;
  error?: string;
  collapsed: boolean;
}

export interface ImageSegment extends MessageSegmentBase {
  type: 'image';
  data: string;       // base64-encoded image data
  mimeType: string;   // e.g. "image/png", "image/jpeg"
  alt?: string;       // optional alt text / description
}

export interface PlanEntry {
  content: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed';
}

export interface PlanSegment extends MessageSegmentBase {
  type: 'plan';
  entries: PlanEntry[];
}

export type Segment = TextSegment | ThinkingSegment | ToolCallSegment | ToolResultSegment | ImageSegment | PlanSegment;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool' | 'system-status';
  content: string;
  timestamp?: number;
  /** Unique message identifier for tree-based branching */
  id?: string;
  /** Parent message ID (null = root message, undefined = legacy linear message) */
  parentId?: string | null;
  citations?: Citation[];
  activities?: AgentActivity[];
  /** Connection ID at the time of generation (for lookup) */
  connectionId?: string;
  /** Snapshot of connection label at generation time (survives connection removal) */
  connectionLabel?: string;
  /** Snapshot of provider name at generation time (for logo rendering) */
  connectionProvider?: string;
  /** True when this message represents an error instead of a response */
  isError?: boolean;
  /** True when the response was interrupted/cancelled before completion */
  interrupted?: boolean;
  /** Thinking/reasoning output from models that support it (e.g. Ollama thinking models) */
  thinking?: string;
  /** Display-only content for the UI (e.g. original user text when skill body is injected into content) */
  displayContent?: string;
  /** Skill name used in this message (for collapsible indicator) */
  skillName?: string;
  /** Tool calls requested by the assistant in this message */
  toolCalls?: ToolCall[];
  /** Tool call ID this message is a response to (for role: 'tool') */
  toolCallId?: string;
  /** Tool call execution activities for UI tracking */
  toolCallActivities?: ToolCallActivity[];
  /** Ordered segments for chronological rendering (text, thinking, tool calls interleaved) */
  segments?: Segment[];
  /** Image attachments on this message */
  attachments?: ImageAttachment[];
  /**
   * Optional ACP protocol-level message ID (forward-compatibility plumbing for
   * `unstable_message_id`). For user messages, set to the outbound `PromptRequest.message_id`;
   * for assistant messages, populated from `agent_message_chunk.message_id` when the agent emits it.
   * Absent when the agent/protocol doesn't support message IDs.
   */
  acpMessageId?: string;
  // --- system-status fields (role: 'system-status') ---
  /** Status type for reconnection messages */
  statusType?: SystemStatusType;
  /** Current reconnection attempt number */
  attempt?: number;
  /** Maximum reconnection attempts */
  maxAttempts?: number;
  /** Timestamp after which a 'reconnected' message should auto-dismiss */
  dismissAt?: number;
  /** Agent name for display in reconnection messages */
  agentName?: string;
}

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AIProvider {
  name: AIProviderType;
  generateText(prompt: string, options?: GenerateOptions): Promise<string>;
  chat(messages: ChatMessage[]): Promise<string>;
}
