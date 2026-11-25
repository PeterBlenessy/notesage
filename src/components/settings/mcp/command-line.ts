/**
 * Shell-style splitting and joining for the Command and Arguments fields of
 * the MCP Add/Edit dialog.
 *
 * The fields hold what a user would type in a terminal (or paste from a
 * server's README), but the server is spawned directly, without a shell. So
 * only the quoting rules are implemented; nothing is expanded or executed:
 *
 * - whitespace separates arguments;
 * - `"..."` and `'...'` group characters (spaces included) into one argument;
 *   an empty pair is an empty argument;
 * - inside double quotes, `\"` and `\\` are an escaped quote / backslash;
 * - inside single quotes everything is literal;
 * - outside quotes, a backslash makes the next character literal (`My\ Notes`);
 * - a quote that is never closed takes the rest of the line.
 *
 * `joinCommandLine(splitCommandLine(x))` splits back to the same arguments,
 * which is what lets the Edit dialog show stored arguments and save them
 * unchanged.
 */

/** Split a command line into its arguments, honouring quotes and escapes. */
export function splitCommandLine(input: string): string[] {
  const out: string[] = [];
  let current = '';
  // True once the current argument has started, even if it is still empty
  // (as for `""`).
  let started = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null;
      } else if (ch === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        current += input[i + 1];
        i++;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      started = true;
      i++;
    } else if (/\s/.test(ch)) {
      if (started) {
        out.push(current);
        current = '';
        started = false;
      }
    } else {
      current += ch;
      started = true;
    }
  }

  if (started) out.push(current);
  return out;
}

/** Characters that never need quoting. */
const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./~^-]+$/;

/** Quote one argument so `splitCommandLine` reads it back unchanged. */
export function quoteArg(arg: string): string {
  if (SAFE_ARG.test(arg)) return arg;
  return `"${arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Join arguments into one line that `splitCommandLine` splits back apart. */
export function joinCommandLine(args: readonly string[]): string {
  return args.map(quoteArg).join(' ');
}

/**
 * What the Command and Arguments fields mean together: the first token of the
 * Command field is the executable, the rest of it goes in front of the
 * arguments. This is what makes a whole pasted line work in the Command field.
 */
export function resolveCommandAndArgs(
  commandField: string,
  argsField: string,
): { command: string; args: string[] } {
  const [command = '', ...leading] = splitCommandLine(commandField);
  return { command, args: [...leading, ...splitCommandLine(argsField)] };
}
