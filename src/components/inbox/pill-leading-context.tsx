import { createContext, useContext, type ReactNode } from "react";

/**
 * A leading slot in the document column's floating pill.
 *
 * The Inbox reader needs a few controls while an item is open — back to the
 * list, position and progress, file / pin / open original. A second pill
 * would fight the viewer's own (every viewer already floats one at the top
 * centre), and a full-width strip is exactly the chrome Quiet Composer does
 * not have. So the controls render INSIDE whatever pill the document column
 * shows: `ViewerToolbarPill` for the viewers, `Toolbar`'s pill variant for a
 * markdown note. Both read this context and render the slot first, with a
 * divider, when it is set.
 */
export const PillLeadingContext = createContext<ReactNode>(null);

export function usePillLeading(): ReactNode {
  return useContext(PillLeadingContext);
}
