// Minimal local type declarations for the pi extension API surface our
// shipped extensions use — pinned to pi v0.80.6's docs/extensions.md.
// The real package is not a dependency: extensions execute INSIDE pi (Bun
// strips the type-only import); these declarations exist so `tsc --noEmit`
// can typecheck the extension sources. Re-verify against the bundled docs
// whenever the pi version pin moves.
declare module "@earendil-works/pi-coding-agent" {
  export interface ToolCallHookEvent {
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }
  export interface ExtensionUi {
    select(title: string, options: string[]): Promise<string | undefined>;
    confirm(title: string, message: string): Promise<boolean>;
    input(title: string, placeholder?: string): Promise<string | undefined>;
  }
  export interface ExtensionContext {
    hasUI: boolean;
    ui: ExtensionUi;
  }
  export type ToolCallHookResult = { block: true; reason?: string } | undefined;
  export interface ExtensionAPI {
    on(
      event: "tool_call",
      handler: (
        event: ToolCallHookEvent,
        ctx: ExtensionContext,
      ) => Promise<ToolCallHookResult> | ToolCallHookResult,
    ): void;
    registerTool(tool: unknown): void;
  }
}
