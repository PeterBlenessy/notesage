/**
 * App-window frame for the marketing hero: the Quiet Composer shell reproduced
 * as static HTML from the component source (exact Tailwind classes + the app's
 * compiled CSS), with the deterministically-generated editor content dropped
 * into the document column. The sidebar is populated with the demo workspace's
 * real data (projects / recent / tags / mentions).
 *
 * Sources: QuietLayout.tsx (shell), QuietSidebar.tsx (header/nav/footer),
 * {Projects,Recent,Tags,Mentions}Section.tsx (rows), FloatingCommandBar.tsx
 * (compact pill). Classes copied verbatim so the compiled utilities style them
 * identically to the app.
 */

// A sidebar "section": uppercase header + rows. (QuietSidebar section pattern.)
function section(label: string, rows: string): string {
  return `<section class="group/section flex flex-col gap-1">
    <header class="flex items-center gap-2 px-2 h-6"><h2 class="text-xs font-medium tracking-wider uppercase text-muted-foreground">${label}</h2></header>
    ${rows}
  </section>`;
}

// A file/tree row (FoldersSection FileRow classes). `active` marks the open doc.
function fileRow(name: string, level = 0, active = false): string {
  const pad = 8 + level * 16;
  return `<div role="treeitem"${active ? ' aria-current="page" data-active="true"' : ""}
    class="h-7 flex items-center gap-2 rounded-sm cursor-pointer text-[13px] text-foreground/90 transition-colors duration-150 hover:bg-muted/50${active ? " text-foreground font-medium bg-muted" : ""}"
    style="padding-left:${pad}px;padding-right:8px">
    <svg class="h-3.5 w-3.5 shrink-0${active ? " text-[var(--color-accent-primary)]" : " text-muted-foreground"}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
    <span class="truncate min-w-0 flex-1">${name}</span>
  </div>`;
}
function folderRow(name: string, level = 0, open = false): string {
  const pad = 8 + level * 16;
  const icon = open
    ? '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>'
    : '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>';
  return `<div role="treeitem" aria-expanded="${open}"
    class="h-7 flex items-center gap-2 rounded-sm cursor-pointer text-[13px] text-foreground/90 transition-colors duration-150 hover:bg-muted/50"
    style="padding-left:${pad}px;padding-right:8px">
    <svg class="h-3.5 w-3.5 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
    <span class="truncate min-w-0 flex-1">${name}</span>
  </div>`;
}
// Recent row (RecentSection classes).
function recentRow(name: string, when: string, active = false): string {
  return `<div role="button"
    class="relative h-7 px-2 flex items-center gap-2 rounded-sm text-[13px] transition-colors duration-150 cursor-pointer ${active ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}">
    <svg class="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
    <span class="truncate min-w-0 flex-1">${name}</span>
    <span class="text-[11px] text-muted-foreground tabular-nums shrink-0 ml-auto">${when}</span>
  </div>`;
}
// Tag / mention row (Tags/MentionsSection classes).
function tokenRow(sigil: string, name: string, count: number): string {
  return `<li><div role="button" class="relative h-7 px-2 flex items-center gap-2 rounded-sm text-[13px] text-foreground cursor-pointer hover:bg-muted/50 transition-colors">
    <span class="truncate min-w-0"><span class="text-muted-foreground">${sigil}</span>${name}</span>
    <span class="text-xs text-muted-foreground ml-auto shrink-0">${count}</span>
  </div></li>`;
}

function sidebar(active = "On Attention.md"): string {
  const isOn = (n: string) => n === active;
  const projects = section(
    "Projects",
    `<div class="flex flex-col gap-0.5">
      ${folderRow("demo", 0, true)}
      ${folderRow("Data", 1)}
      ${folderRow("Drafts", 1)}
      ${folderRow("Essays", 1, true)}
      ${fileRow("Notes on Craft.md", 2, isOn("Notes on Craft.md"))}
      ${fileRow("On Attention.md", 2, isOn("On Attention.md"))}
      ${folderRow("Guides", 1)}
      ${folderRow("Research", 1)}
      ${fileRow("Prompt library.md", 1)}
      ${fileRow("README.md", 1)}
    </div>`,
  );
  const recent = section(
    "Recent",
    `<div class="flex flex-col gap-0.5">
      ${recentRow("On Attention.md", "now", isOn("On Attention.md"))}
      ${recentRow("Formatting.md", "2m", isOn("Formatting.md"))}
      ${recentRow("Quarterly review.md", "1h", isOn("Quarterly review.md"))}
    </div>`,
  );
  const tags = section(
    "Tags",
    `<ul class="flex flex-col">
      ${tokenRow("#", "attention", 2)}${tokenRow("#", "review", 2)}${tokenRow("#", "writing", 1)}${tokenRow("#", "craft", 1)}${tokenRow("#", "research", 1)}
    </ul>`,
  );
  const mentions = section(
    "Mentions",
    `<ul class="flex flex-col">
      ${tokenRow("@", "alex", 2)}${tokenRow("@", "editor", 1)}${tokenRow("@", "maya", 1)}
    </ul>`,
  );
  return `<nav aria-label="Workspace sidebar" class="relative flex flex-col px-4 pt-10 pb-2 h-full shrink-0 min-h-0 overflow-hidden border-r border-border-strong bg-muted/30" style="width:252px">
    <div class="absolute left-4 top-3 flex gap-2" aria-hidden="true">
      <span class="size-3 rounded-full" style="background:#ff5f57"></span><span class="size-3 rounded-full" style="background:#febc2e"></span><span class="size-3 rounded-full" style="background:#28c840"></span>
    </div>
    <div class="flex items-center gap-2.5 px-1 py-1.5 mb-2 select-none">
      <span aria-hidden="true" class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground text-background text-[12px] italic font-semibold font-serif">N</span>
      <div class="min-w-0 flex flex-col leading-tight">
        <span class="text-[13px] font-semibold truncate">Notesage</span>
        <span class="text-[11px] text-muted-foreground tabular-nums">1 project<span aria-hidden="true"> · </span>8 notes</span>
      </div>
    </div>
    <div class="flex flex-col gap-4 min-h-0 flex-1 overflow-y-auto -mr-2 pr-2">
      ${projects}${recent}${tags}${mentions}
    </div>
    <div class="mt-2 pt-2 flex items-center gap-1 shrink-0 border-t border-border">
      <button aria-label="Settings" class="inline-flex items-center justify-center size-7 shrink-0 rounded-md text-muted-foreground hover:text-foreground">
        <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
      <div class="ml-1 flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums select-none">
        <span>260 words</span><span class="opacity-70">⌘. focus</span>
      </div>
    </div>
  </nav>`;
}

// --- Chat: messages, segments (ChatMessage.tsx + segment views) ---
const IC = {
  user: '<svg class="h-3 w-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  spark: '<svg class="h-3 w-3 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/></svg>',
  brain: '<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5a3 3 0 1 0-5.997.142M12 5a3 3 0 1 1 5.997.142M12 5v14M6 7.142A3 3 0 0 0 4 10a3 3 0 0 0 1.5 2.6M18 7.142A3 3 0 0 1 20 10a3 3 0 0 1-1.5 2.6M5.5 12.6A3 3 0 0 0 7 18a3 3 0 0 0 5 .5 3 3 0 0 0 5-.5 3 3 0 0 0 1.5-5.4"/></svg>',
  chev: '<svg class="h-2.5 w-2.5 -rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  chevDown: '<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  wrench: '<svg class="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>',
  imagePlus: '<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 5h6"/><path d="M19 2v6"/><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/><circle cx="9" cy="9" r="2"/></svg>',
  arrowUp: '<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>',
  // Toolbar icons (CommandBarContext): chip logo + w-3.5 IconButtons.
  provider: '<svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M13.6 3 20 21h-3.4l-1.3-3.9H8.7L7.4 21H4l6.4-18h3.2Zm-.7 11.2L12 8.4l-1.9 5.8h3.8Z"/></svg>',
  folderSm: '<svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>',
  plus: '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  clock: '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
  pin: '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>',
  xIcon: '<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  gear: '<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>',
  shield: '<svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
  chevUp: '<svg class="h-3 w-3 opacity-50 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
};

function avatar(kind: "user" | "assistant"): string {
  return `<div class="h-6 w-6 rounded-full shrink-0 flex items-center justify-center mt-0.5 bg-muted">${kind === "user" ? IC.user : IC.spark}</div>`;
}
function userMessage(text: string): string {
  return `<div class="mb-4"><div class="flex gap-2.5 flex-row-reverse">${avatar("user")}<div class="group relative max-w-[82%] rounded-xl rounded-tr-sm bg-secondary border border-border px-3.5 py-2.5 text-foreground"><p class="m-0 text-sm leading-relaxed">${text}</p></div></div></div>`;
}
// ThinkingSegmentView — collapsed toggle + expanded left-border italic mono block.
function thinkingSeg(text: string): string {
  return `<div class="my-0.5">
    <div class="flex items-center gap-1 px-1 text-[11px] text-muted-foreground/60">${IC.brain}${IC.chevDown}<span>Thought for 3s</span></div>
    <div class="border-l border-border pl-2.5 py-0.5 mt-0.5"><div class="text-[11px] text-muted-foreground/70 italic whitespace-pre-wrap font-mono leading-relaxed">${text}</div></div>
  </div>`;
}
// ToolCallSegmentView — compact icon + label + status row.
function toolSeg(icon: string, label: string): string {
  return `<div class="my-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground bg-background/50"><div class="flex items-center gap-1.5"><span class="shrink-0 opacity-60">${icon}</span><span class="truncate">${label}</span><span class="shrink-0 opacity-60">${IC.check}</span></div></div>`;
}
function textBubble(text: string): string {
  return `<div class="group relative rounded-xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-foreground my-0.5"><p class="m-0 text-sm leading-relaxed">${text}</p></div>`;
}
function assistantMessage(inner: string): string {
  return `<div class="mb-4"><div class="flex gap-2.5">${avatar("assistant")}<div class="min-w-0 max-w-[86%] flex flex-col">${inner}</div></div></div>`;
}
// ToolCallPermissionCard + TieredApprovalButtons.
function permissionCard(name: string, args: string): string {
  return `<div class="mb-4 ml-[34px]"><div class="rounded-lg border border-border bg-card px-3 py-2.5">
    <div class="flex items-start gap-2.5">${IC.wrench}<div class="flex-1 min-w-0"><p class="text-xs font-medium text-foreground">Tool call: ${name}</p><pre class="mt-1 text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">${args}</pre></div></div>
    <div class="mt-2 ml-[26px] flex items-center gap-1.5">
      <button class="h-7 px-2.5 rounded-md border border-border-strong bg-background text-xs text-foreground hover:bg-muted transition-colors">Deny (24s)</button>
      <div class="flex items-center"><button class="h-7 px-2.5 rounded-l-md bg-[var(--color-accent-primary)] text-white text-xs">Allow</button><button class="h-7 px-1 rounded-r-md bg-[var(--color-accent-primary)] text-white border-l border-white/20 flex items-center">${IC.chevDown}</button></div>
    </div>
  </div></div>`;
}

const DEMO_CHAT =
  userMessage("Tighten the opening line, then save the file.") +
  assistantMessage(
    thinkingSeg("The first sentence buries the point. Lead with “holding still,” cut the hedge, keep the rhythm.") +
    toolSeg(IC.file, "Reading On Attention.md") +
    textBubble("Here’s a tighter opening. Saving the change now:"),
  ) +
  permissionCard("write_file", '{ "path": "Essays/On Attention.md" }');

// Input row (exact FloatingCommandBar structure): attach-image + textarea + send.
const COMPOSER = `<div class="px-3 py-2 flex items-end gap-2 shrink-0">
  <button aria-label="Attach image" class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">${IC.imagePlus}</button>
  <div class="flex-1 min-w-0 text-sm text-muted-foreground leading-relaxed py-0.5">Ask, search, or type / for skills…</div>
  <button aria-label="Send message" class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-primary)] text-white">${IC.arrowUp}</button>
</div>`;
// Top toolbar (CommandBarContext, rendered at the TOP of the panel, border-b):
// provider pill · model pill · | · projects pill · | · mode pill · spacer ·
// New-chat · History · Pin · Close. Chips reuse the exact source class.
const CHIP = "inline-flex items-center gap-1.5 h-7 px-2 rounded-md shrink-0 text-xs font-medium text-foreground border border-transparent bg-muted";
const ICON_BTN = "flex items-center justify-center w-6 h-6 rounded-md shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors";
const DIVIDER = '<div class="h-4 w-px bg-border shrink-0"></div>';
function iconBtn(label: string, svg: string): string {
  return `<button aria-label="${label}" class="${ICON_BTN}">${svg}</button>`;
}
// Provider quick-config: a gear button (Settings2), NOT a model-name chip.
const MODEL_GEAR = `<button aria-label="Provider quick config" class="inline-flex items-center justify-center h-7 w-7 rounded-md shrink-0 text-muted-foreground border border-transparent hover:text-foreground hover:bg-muted hover:border-border transition-colors duration-150">${IC.gear}</button>`;
// AcpModePicker: Shield + mode label + ChevronUp.
const MODE_PILL = `<button class="flex items-center gap-1 h-7 px-2 rounded-md shrink-0 text-xs font-medium text-muted-foreground border border-transparent hover:text-foreground hover:bg-muted hover:border-border transition-colors duration-150">${IC.shield}Agent${IC.chevUp}</button>`;
const TOP_TOOLBAR = `<div data-cmd-context class="flex items-center gap-1.5 px-3 py-2 border-b border-border text-xs text-muted-foreground overflow-hidden shrink-0">
  <button class="${CHIP}"><span class="w-3.5 h-3.5 flex items-center justify-center text-foreground">${IC.provider}</span><span>Claude</span></button>
  ${MODEL_GEAR}
  ${DIVIDER}
  <button class="${CHIP}"><span class="w-3.5 h-3.5 flex items-center justify-center text-muted-foreground">${IC.folderSm}</span><span>demo</span></button>
  ${DIVIDER}
  ${MODE_PILL}
  <div class="flex-1 min-w-2"></div>
  ${iconBtn("New chat", IC.plus)}
  ${iconBtn("History", IC.clock)}
  ${iconBtn("Pin chat", IC.pin)}
  ${iconBtn("Close", IC.xIcon)}
</div>`;

/** Expanded floating command bar (chat) — 640x480, rounded-2xl, bottom-centre. */
function commandBarExpanded(): string {
  return `<div class="absolute bottom-10 left-1/2 -translate-x-1/2 z-40" data-cmd-bar data-expanded="true">
    <div class="w-[640px] h-[480px] max-w-[92%] rounded-2xl border border-border bg-popover shadow-lg flex flex-col overflow-hidden">
      ${TOP_TOOLBAR}
      <div class="flex-1 overflow-y-auto px-4 py-4 min-h-0">${DEMO_CHAT}</div>
      ${COMPOSER}
    </div>
  </div>`;
}
/** Pinned command bar — 400px docked right-edge panel. */
function commandBarPinned(): string {
  return `<aside role="region" aria-label="Chat panel" data-cmd-bar data-cmd-bar-pinned="true" class="w-[400px] shrink-0 h-full border-l border-border bg-popover flex flex-col overflow-hidden">
    ${TOP_TOOLBAR}
    <div class="flex-1 overflow-y-auto px-4 py-4 min-h-0">${DEMO_CHAT}</div>
    ${COMPOSER}
  </aside>`;
}

const TRAFFIC = `<div class="absolute left-4 top-3 z-50 flex gap-2" aria-hidden="true">
  <span class="size-3 rounded-full" style="background:#ff5f57"></span><span class="size-3 rounded-full" style="background:#febc2e"></span><span class="size-3 rounded-full" style="background:#28c840"></span>
</div>`;

// --- Settings dialog (SettingsShell / SettingsRow / SettingsGroup) ---
function settingsRow(label: string, desc: string, control: string): string {
  return `<div class="px-0 py-3">
    <div class="flex items-center gap-4 min-h-[28px]">
      <div class="min-w-0 flex-1"><span class="text-[13px] font-medium text-foreground">${label}</span></div>
      <div class="shrink-0">${control}</div>
    </div>
    <div class="flex items-baseline gap-4 mt-1"><span class="flex-1 min-w-0 text-[12px] text-muted-foreground leading-relaxed">${desc}</span></div>
  </div>`;
}
function settingsGroup(title: string, rows: string): string {
  return `<section class="mb-6 last:mb-0"><h3 class="text-[11px] font-semibold tracking-wider uppercase text-foreground mb-1">${title}</h3>${rows}</section>`;
}
function segmented(options: string[], activeIdx: number): string {
  return `<div class="inline-flex rounded-lg border border-border-strong bg-muted/40 p-0.5 text-[12px]">${options
    .map((o, i) => `<span class="px-2.5 py-1 rounded-md ${i === activeIdx ? "bg-background shadow-sm font-medium text-foreground" : "text-muted-foreground"}">${o}</span>`)
    .join("")}</div>`;
}
function settingsDialog(): string {
  const nav = ["Appearance", "Writing", "AI Providers", "Skills & Agents", "Voice", "Projects", "Automations", "System"];
  const navHtml = nav
    .map((n, i) => `<div class="flex items-center gap-2 h-8 px-2 rounded-md text-[13px] ${i === 0 ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50"}"><span class="flex-1 truncate">${n}</span></div>`)
    .join("");
  const swatch = (bg: string, active = false) =>
    `<span class="inline-flex size-6 rounded-full border border-border-strong ${active ? "ring-2 ring-offset-2 ring-offset-background ring-[var(--color-accent-primary)]" : ""}" style="background:${bg}"></span>`;
  const accents = `<div class="flex items-center gap-2.5">${swatch("oklch(55% 0 0)")}${swatch("oklch(68% 0.21 37)", true)}${swatch("oklch(56% 0.16 253)")}${swatch("linear-gradient(135deg,oklch(68% 0.21 37),oklch(56% 0.16 253))")}</div>`;
  const slider = `<div class="w-44 h-1.5 rounded-full bg-muted relative">
    <div class="absolute inset-y-0 left-0 rounded-full bg-[var(--color-accent-primary)]" style="width:34%"></div>
    <div class="absolute size-3.5 rounded-full bg-background border border-border-strong shadow" style="left:calc(34% - 7px);top:-4px"></div></div>`;
  const toggle = (on: boolean) =>
    `<span class="inline-flex h-5 w-9 items-center rounded-full ${on ? "bg-[var(--color-accent-primary)]" : "bg-muted border border-border-strong"} px-0.5"><span class="size-4 rounded-full bg-background shadow transition ${on ? "translate-x-4" : ""}"></span></span>`;
  const panel = `${settingsGroup("Theme", settingsRow("Appearance", "Light, dark, or match the system.", segmented(["Light", "Dark", "System"], 0)) + settingsRow("Contrast", "Soften the contrast for longer sessions.", slider))}
    ${settingsGroup("Accent", settingsRow("Accent color", "A single opt-in colour for primary actions and focus rings.", accents))}
    ${settingsGroup("Chrome", settingsRow("Show title bar", "Show the optional document title bar above the editor.", toggle(false)) + settingsRow("Quiet chrome", "Fade toolbar and status while you type.", segmented(["Relaxed", "Default", "Aggressive"], 1)))}`;
  return `<div class="absolute inset-0 z-50 flex items-center justify-center">
    <div class="absolute inset-0 bg-black/40"></div>
    <div class="relative w-[860px] h-[560px] max-w-[92%] max-h-[86%] rounded-xl border border-border bg-popover shadow-2xl overflow-hidden flex">
      <aside class="w-[196px] flex min-h-0 flex-col border-r border-border bg-muted/30 shrink-0">
        <div class="px-3 pt-3 pb-2 border-b border-border/60"><span class="text-[13px] font-semibold">Settings</span></div>
        <div class="p-2 flex flex-col gap-0.5 overflow-y-auto">${navHtml}</div>
      </aside>
      <div class="relative flex-1 flex min-h-0 flex-col overflow-hidden">
        <div class="px-3 pt-3 pb-2 border-b border-border/60"><span class="text-[13px] font-semibold">Appearance</span></div>
        <div class="px-6 py-5 overflow-y-auto">${panel}</div>
      </div>
    </div>
  </div>`;
}

export interface WindowOpts {
  /** Sidebar visible (Quiet Composer hides it via ⌘⇧L). */
  sidebar?: boolean;
  /** Focus mode (⌘.) — chrome fades, current block stays. */
  focus?: boolean;
  /** Filename to mark active in the sidebar. */
  active?: string;
  /** Command-bar state. */
  cmdBar?: "pill" | "expanded" | "pinned";
  /** Modal overlay on top of the window. */
  modal?: "settings";
}

const PILL = `<div class="absolute bottom-10 left-1/2 -translate-x-1/2 z-40" data-cmd-bar data-expanded="false">
  <div class="w-[480px] max-w-[90vw] h-12 rounded-xl border border-border bg-popover shadow-lg overflow-hidden">
    <button class="flex h-full w-full items-center justify-center px-4 text-sm text-muted-foreground">Press ⌘K to ask</button>
  </div>
</div>`;

/** Full app-window mockup wrapping generated editor HTML. */
export function appWindow(editorHtml: string, opts: WindowOpts = {}): string {
  const { sidebar: showSidebar = true, focus = false, active = "On Attention.md", cmdBar = "pill", modal } = opts;
  const overlay = cmdBar === "expanded" ? commandBarExpanded() : cmdBar === "pill" ? PILL : "";
  const docColumn = `<div class="relative flex-1 flex flex-col min-w-0 min-h-0">
    ${showSidebar ? "" : TRAFFIC}
    <div class="flex-1 overflow-hidden">
      <div class="doc-col mx-auto w-full" style="max-width:820px;padding:${showSidebar ? "2.5rem" : "3.5rem"} 1.5rem 6rem"><div class="ProseMirror" translate="no">${editorHtml}</div></div>
    </div>
    ${overlay}
  </div>`;
  const rootClass = `app relative flex h-full w-full bg-background overflow-hidden${focus ? " focus-mode" : ""}`;
  return `<div class="app-window"><div class="${rootClass}" data-quiet-layout-root data-cmd-bar-pinned="${cmdBar === "pinned"}">
    ${showSidebar ? sidebar(active) : ""}
    ${docColumn}
    ${cmdBar === "pinned" ? commandBarPinned() : ""}
    ${modal === "settings" ? settingsDialog() : ""}
  </div></div>`;
}
