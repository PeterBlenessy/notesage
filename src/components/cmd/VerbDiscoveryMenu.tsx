import { cn } from "@/lib/utils";
import { VERBS } from "@/components/cmd/verb-modes";

// ---------------------------------------------------------------------------
// VerbDiscoveryMenu — bare `:` (or `:partial-name`) discovery list
// (PRD `2026-04-28-cmd-bar-verb-prefixes`). Renders every registered
// verb whose name starts with the typed partial; an empty `typedName`
// surfaces all verbs. Click / Enter on a row autocompletes to
// `:fullName ` and jumps the cursor into the filter slot (the parent
// owns that side of the wiring; this component just emits the picked
// verb name).
// ---------------------------------------------------------------------------

interface VerbDiscoveryMenuProps {
  typedName: string;
  onPick: (verbName: string) => void;
}

export function VerbDiscoveryMenu({ typedName, onPick }: VerbDiscoveryMenuProps) {
  const verbs = Object.values(VERBS);
  const filtered = typedName
    ? verbs.filter((v) => v.name.startsWith(typedName))
    : verbs;

  if (filtered.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground" role="status">
        No verb command matching <span className="font-mono">:{typedName}</span>
      </div>
    );
  }

  return (
    <ul role="listbox" aria-label="Command bar verbs" className="m-0 p-0 list-none">
      {filtered.map((verb) => (
        <li key={verb.id}>
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => onPick(verb.name)}
            className={cn(
              "w-full text-left px-3 py-2 text-sm flex items-baseline gap-2",
              "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
            )}
          >
            <span className="font-mono text-foreground">:{verb.name}</span>
            <span className="text-xs text-muted-foreground truncate">
              {verb.description}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default VerbDiscoveryMenu;
