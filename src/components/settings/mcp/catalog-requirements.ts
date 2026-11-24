import type { McpCatalogItem, McpCatalogRequiredArg } from '@/stores/mcp-store';
import { t, type MessageKey } from '@/lib/i18n';

/**
 * Arguments a catalog server needs from the user before it can run.
 *
 * The catalog itself (`mcp_catalog_list`) describes a command line and the
 * env keys a server wants, but several servers also need an argument nobody
 * can pre-fill: the Filesystem server exits at once with a usage error unless
 * it is given at least one directory. A catalog entry may declare such
 * arguments itself (`required_args`); for the reference servers that do not,
 * they are declared here, keyed by catalog id.
 *
 * Reviewed against the shipped catalog: Fetch, Memory, Sequential Thinking,
 * Time and Everything start with no arguments and no env keys. Git works
 * without a repository (each tool call names one) but is normally pointed at
 * one, so it is offered as optional.
 */
interface BuiltInArg extends Omit<McpCatalogRequiredArg, 'label'> {
  labelKey: MessageKey;
}

const BUILT_IN: Record<string, BuiltInArg[]> = {
  filesystem: [{ key: 'directory', labelKey: 'mcpd.argAllowedFolder', kind: 'path', required: true }],
  git: [
    {
      key: 'repository',
      labelKey: 'mcpd.argRepository',
      kind: 'path',
      flag: '--repository',
      required: false,
    },
  ],
};

/** The arguments the Add form must ask for when adding this catalog entry. */
export function requiredArgsFor(item: McpCatalogItem): McpCatalogRequiredArg[] {
  if (item.required_args && item.required_args.length > 0) return item.required_args;
  return (BUILT_IN[item.id] ?? []).map(({ labelKey, ...rest }) => ({ ...rest, label: t(labelKey) }));
}

/** True unless the argument is explicitly optional. */
export function isArgRequired(arg: McpCatalogRequiredArg): boolean {
  return arg.required !== false;
}

/** The command-line arguments a set of answers adds, in declaration order. */
export function argsFromAnswers(
  required: readonly McpCatalogRequiredArg[],
  answers: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = [];
  for (const arg of required) {
    const value = (answers[arg.key] ?? '').trim();
    if (!value) continue;
    if (arg.flag) out.push(arg.flag);
    out.push(value);
  }
  return out;
}
