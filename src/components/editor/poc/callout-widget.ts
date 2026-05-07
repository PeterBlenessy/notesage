import { WidgetType } from "@codemirror/view";

const CALLOUT_ICONS: Record<string, string> = {
  note: "ℹ",
  tip: "💡",
  warning: "⚠",
  important: "❗",
  info: "ℹ",
};

const CALLOUT_LABELS: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  warning: "Warning",
  important: "Important",
  info: "Info",
};

export class CalloutWidget extends WidgetType {
  constructor(
    readonly type: string,
    readonly title: string,
    readonly body: string,
  ) {
    super();
  }

  eq(other: CalloutWidget): boolean {
    return (
      other.type === this.type &&
      other.title === this.title &&
      other.body === this.body
    );
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = `cm-poc-callout cm-poc-callout-${this.type}`;
    wrap.contentEditable = "false";

    const head = document.createElement("div");
    head.className = "cm-poc-callout-head";
    const icon = document.createElement("span");
    icon.className = "cm-poc-callout-icon";
    icon.textContent = CALLOUT_ICONS[this.type] ?? "•";
    head.appendChild(icon);
    const label = document.createElement("span");
    label.className = "cm-poc-callout-label";
    label.textContent = this.title || CALLOUT_LABELS[this.type] || this.type;
    head.appendChild(label);
    wrap.appendChild(head);

    if (this.body.trim()) {
      const body = document.createElement("div");
      body.className = "cm-poc-callout-body";
      // Preserve markdown soft breaks; this is a PoC widget, so render as plain text
      body.textContent = this.body;
      wrap.appendChild(body);
    }

    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}
