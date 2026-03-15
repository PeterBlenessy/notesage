**Status:** 🔮 Future

## In progress

- [x] Move files between projects and folders. Phase 1 MVP uses context menu “Move to” -&gt; “Folder in listed projects”.

- [ ] Move files between projects and folders. Phase 2 implements dragging and dropping them in the file / project explorer.

## New ideas

- [ ] Add an AI tool for fetching web pages and convert it to markdown

- [ ] Search in files improvement:

  - [ ] command pallette groups the list and has a “recent” section. I would like this also in the search in files feature (cmd+shift+F)

  - [ ] search in file searches only in file names. Can we search in the file text too?

- [ ] Pin notes in tabs bar or introduce a pinned notes section in the left sidebar, to quickly access important notes?

- [ ] Dashboard tab dynamically collecting and visualizing important parts of the notes distributed over all projects, e.g. based on selected tags, action items, actionable items, outstanding questions,  etc. Items are presented as cards, and clicking on them takes you to the note where they are located. This would be a great way to quickly access important information across all projects. Dashboard cards are configurable, so users can select what to see on the dashboard.

- [ ] Agents have no message history. User should be able to set this manually, or, if possible, agents should be instructed to remember on server side.

## [agent-install-wizard](http://agent-install-wizard.md)

im looking at [agent-install-wizard.md](http://agent-install-wizard.md) and i think we should talk it over a bit, so we define a solution that actually does improve the user experience. I am thinking that if we do this, we cannot just automate installation of the CLI binaries, i think we need to assume that the user who needs that kind of support, has no other dependencies installed either. This means, that we would need to install nodejs, npm, and all other dependencies necessary to get the CLI up and running.

Analyze what is required for each provider CLI that we support, and analyse the work that it requires.

I am also interested in “sandbox” solution, so research what could be done to not install the dependencies globally in the user’s system, but instead use some kind of sandboxing solution. I think Anthropic did this to get Claude Cowork and Claude Code working in a kind of isolated way. We do

## Changes

- [ ] New icons for pdf, epub, log, md, etc. file types, to more clearly reflect the file type and make it easier to identify them in the file explorer.

### Bugs

- [ ] There seems to be an issue with comment positioning. When I add a comment then add some other text to the document, the comment position moves to the wrong text. This is a critical issue. Please investigate this issue and implement a fix to ensure that comments remain correctly positioned even when the document is edited.

### Needs manual verification

- [x] There still seems to be someting wrong with the GitHub LSP authentication, which you tried to fix a couple of times now. I get redirected to the GitHub authentication page and asked to enter an 8-digit code, which should appear in the client app, but it never does. Make sure that the code follows all steps involved in setting up the GitHub LSP client and analyse the CLI providers too, so we ensure that they work when needed. Since you have tried to fix this issue a couple of times now, i want you ot log all responses from the LSP with all message object content so I can try to assist in the debugging.

  - [x] <https://github.com/copilotlsp-nvim/copilot-lsp/pull/7/changes/348c49bc484f6ac967f9efffb8be911effcccffe>

### Defered #ai

- When accepting external changes to a document, the formatting is often messed up. Paragraph text becomes heading or code; everithing can become bold, etc. My tought is that we apply the diff on rendered text level, not raw markdown level. Markdown characters are probably thrown away messing up the document formatting in markdown. So we must separate the visualizing and applying diffs. - *defered*