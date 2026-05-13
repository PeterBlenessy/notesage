# Privacy

Your notes are yours. Here is exactly how Notesage handles your data.

---

## Local-first by default

Every note you write is saved as a plain text file on your device. Notesage never uploads your notes to our servers — because we don't have any. Your files live in a folder you choose, on your computer, under your control.

When you close Notesage, your notes are just files on your Mac. You can back them up, version-control them, or move them anywhere.

---

## API keys stored securely in your system keychain

If you connect an AI provider using an API key (Anthropic, OpenAI, or a compatible service), that key is stored in your **system keychain** — the same secure storage that your Mac uses for passwords. The key is never written to a plain text file, never stored in a browser, and never transmitted to Notesage's servers.

When you remove a connection, the key is deleted from your keychain immediately.

---

## AI agents run in a restricted sandbox

When you use an AI agent (like Claude Code or Codex), Notesage runs it in a **restricted environment**:

- The agent can only read and write files inside the projects you have open in that chat session.
- Network access is filtered: the agent can only reach the domains it needs (like the AI provider's API). Unknown domains are blocked and shown to you for approval.
- On macOS, the sandbox is enforced at the operating system level — the agent physically cannot access your other files, even if it tries.

---

## iCloud sync is optional

Notesage supports syncing your notes via iCloud, but it is **opt-in per project**. If you don't turn it on, nothing is synced. If you do, your files travel through Apple's encrypted iCloud infrastructure — the same path used by apps like Pages and Notes.

The local index that Notesage builds for search is excluded from iCloud sync. Each device rebuilds its own index from the synced files.

---

## No telemetry by default

Notesage does not send any usage data, crash reports, or analytics by default. The app works entirely offline. The only network connections it makes are the ones you explicitly set up (your AI provider, iCloud if enabled).

Some third-party AI providers may collect data according to their own policies. Check your provider's documentation for details.

---

## Open source

Notesage is open source. You can read the code, audit what it does, and build it yourself. There is no hidden behaviour.
