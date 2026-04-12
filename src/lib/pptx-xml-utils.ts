import JSZip from "jszip";

// ---------------------------------------------------------------------------
// XML helpers — DOM querying, namespace-aware element selection, attribute extraction
// ---------------------------------------------------------------------------

export function parseXmlString(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

export async function readXml(zip: JSZip, path: string): Promise<Document | null> {
  const file = zip.file(path);
  if (!file) return null;
  const text = await file.async("text");
  return parseXmlString(text);
}

export async function readRels(zip: JSZip, slidePath: string): Promise<Record<string, string>> {
  const dir = slidePath.substring(0, slidePath.lastIndexOf("/"));
  const name = slidePath.substring(slidePath.lastIndexOf("/") + 1);
  const relsPath = `${dir}/_rels/${name}.rels`;
  const doc = await readXml(zip, relsPath);
  return doc ? parseRelationships(doc) : {};
}

export function parseRelationships(doc: Document): Record<string, string> {
  const map: Record<string, string> = {};
  const rels = doc.getElementsByTagName("Relationship");
  for (let i = 0; i < rels.length; i++) {
    const rel = rels[i];
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) map[id] = target;
  }
  return map;
}

export function normalizePath(base: string, relative: string): string {
  if (relative.startsWith("/")) return relative.substring(1);
  const parts = `${base}/${relative}`.split("/");
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== ".") resolved.push(p);
  }
  return resolved.join("/");
}

/** Get text content of first element matching a local-name selector */
export function qs(parent: Element | Document, localName: string): Element | null {
  return parent.querySelector(`*|${localName}`) ??
    findByLocalName(parent, localName);
}

export function qsa(parent: Element | Document, localName: string): Element[] {
  const result = parent.querySelectorAll(`*|${localName}`);
  if (result.length > 0) return Array.from(result);
  return findAllByLocalName(parent, localName);
}

export function findByLocalName(parent: Element | Document, name: string): Element | null {
  const children = parent instanceof Document ? parent.documentElement?.children : parent.children;
  if (!children) return null;
  for (let i = 0; i < children.length; i++) {
    if (children[i].localName === name) return children[i];
    const found = findByLocalName(children[i], name);
    if (found) return found;
  }
  return null;
}

export function findAllByLocalName(parent: Element | Document, name: string): Element[] {
  const results: Element[] = [];
  const root = parent instanceof Document ? parent.documentElement : parent;
  if (!root) return results;
  const walk = (el: Element) => {
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i];
      if (child.localName === name) results.push(child);
      walk(child);
    }
  };
  walk(root);
  return results;
}

export function getAttr(el: Element, name: string): string | null {
  return el.getAttribute(name);
}

export function intAttr(el: Element, name: string, fallback = 0): number {
  const v = el.getAttribute(name);
  return v ? parseInt(v, 10) || fallback : fallback;
}
