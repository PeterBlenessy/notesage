# Privacy & Data — What Notesage Does (and Doesn't Do)

Notesage is built on a simple principle: **your notes are yours**. Here's exactly how that works.

---

## Your notes stay on your machine

Notesage is a local-first app. Every note you write is stored as a plain text file on your hard drive — in whatever folder you choose. Nothing is uploaded to Notesage's servers (there are none). Notes only leave your machine if you explicitly choose to sync them via iCloud.

If you close the app without saving, your work is still in the file. If Notesage is deleted, your files are completely intact. You are never locked in.

---

## API keys are stored in your Mac's Keychain

When you connect an AI provider (Anthropic, OpenAI, etc.), your API key is stored in the macOS Keychain — the same secure system that holds your passwords. It is never written to a plain text file, never logged, and never sent anywhere except directly to the AI provider when you make a request.

The Notesage application itself cannot read your API key — it asks the Keychain to retrieve it on your behalf when needed, and the Keychain verifies that the request is coming from Notesage before allowing it.

---

## AI agents are sandboxed

When you run an AI agent that can use tools — reading files, browsing the web, running scripts — it operates inside a strict sandbox:

- **Filesystem:** agents can only read and write the folders you have selected for the current conversation. They cannot access your Documents folder, your Downloads folder, or any other part of your Mac unless you explicitly grant access.
- **Network:** agent network traffic goes through a local filter that shows you which domains the agent is trying to reach. You can allow, block, or require approval for each domain. Kernel-level network blocking prevents agents from bypassing the filter.
- **Secrets:** files like `.env` files, SSH keys, and AWS credentials are explicitly blocked from agent access.

You can review and adjust these settings any time in **Settings → Connections → Security**.

---

## iCloud sync is optional

If you want your notes available across your Mac devices, Notesage can sync individual projects to iCloud. This is opt-in — disabled by default — and you choose which projects to sync. Notes that aren't synced never leave your Mac.

iCloud sync is a standard Apple feature and follows Apple's privacy policies. Notesage has no visibility into what is or isn't synced.

---

## No telemetry by default

Notesage does not collect analytics, crash reports, usage statistics, or any other telemetry unless you explicitly opt in. The app does not phone home, does not check which features you use, and does not track how often you open it.

The only network requests Notesage makes by default are:
- Checking for app updates (to notesage's GitHub releases page)
- Any AI requests you manually initiate

Both of these are visible to you and under your control.

---

## Open-source transparency

Notesage is open source. The code that handles your files, your API keys, and your AI connections is publicly readable. If you want to verify exactly how any of this works, [the source is on GitHub](https://github.com/PeterBlenessy/notesage).
