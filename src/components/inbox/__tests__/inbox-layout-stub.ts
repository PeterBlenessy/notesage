/**
 * Just enough layout for the Inbox's window, in jsdom.
 *
 * jsdom lays nothing out: every element measures 0. The Inbox view treats a
 * viewport that measures 0 as "no layout" and renders every line, which is
 * what the ordinary component tests run under. To test the WINDOW, the
 * scroller needs a height, each line needs one, and `scrollTop` has to hold
 * a value — which is all this provides. It stubs measurements, not the
 * windowing: which lines mount is still decided by the real code.
 */
export interface InboxLayoutStub {
  /** Put things back. Call in `afterEach`. */
  restore: () => void;
}

export interface InboxLayoutOptions {
  /** Height of the scroll container. */
  viewport?: number;
  /** Width of the list (decides the gallery's columns). */
  width?: number;
  /** Height of a list row, of a gallery row of cards, and of a date header. */
  row?: number;
  header?: number;
}

type Descriptor = PropertyDescriptor | undefined;

export function stubInboxLayout(options: InboxLayoutOptions = {}): InboxLayoutStub {
  const { viewport = 800, width = 900, row = 80, header = 36 } = options;
  const proto = HTMLElement.prototype;
  const saved: Record<string, Descriptor> = {
    offsetHeight: Object.getOwnPropertyDescriptor(proto, "offsetHeight"),
    offsetWidth: Object.getOwnPropertyDescriptor(proto, "offsetWidth"),
    scrollTop: Object.getOwnPropertyDescriptor(proto, "scrollTop"),
    scrollTo: Object.getOwnPropertyDescriptor(proto, "scrollTo"),
  };
  const scrollTops = new WeakMap<HTMLElement, number>();

  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute("data-doc-scroll")) return viewport;
      if (this.hasAttribute("data-index")) return this.tagName === "H2" ? header : row;
      return 0;
    },
  });
  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-doc-scroll") || this.getAttribute("role") === "listbox" ? width : 0;
    },
  });
  Object.defineProperty(proto, "scrollTop", {
    configurable: true,
    get(this: HTMLElement) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: HTMLElement, value: number) {
      scrollTops.set(this, value);
    },
  });
  Object.defineProperty(proto, "scrollTo", {
    configurable: true,
    writable: true,
    value(this: HTMLElement, target?: ScrollToOptions | number, y?: number) {
      const top = typeof target === "number" ? (y ?? 0) : (target?.top ?? 0);
      scrollTops.set(this, top);
      this.dispatchEvent(new Event("scroll"));
    },
  });

  return {
    restore: () => {
      for (const [name, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(proto, name, descriptor);
        else delete (proto as unknown as Record<string, unknown>)[name];
      }
    },
  };
}

/** `count` captures, newest first, one per hour back from now — so they
 *  fall into several date groups. */
export function inboxListing(dir: string, count: number, now: number = Math.floor(Date.now() / 1000)) {
  return Array.from({ length: count }, (_, i) => {
    const name = `Article ${String(i).padStart(3, "0")}.html`;
    return { name, path: `${dir}/${name}`, is_directory: false, hidden: false, modified: now - i * 3600 };
  });
}
