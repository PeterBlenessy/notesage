# Connecting AI to Notesage

Notesage works with any AI you already use. You're never locked into one provider, and you can switch or mix providers at any time from **Settings → Connections**.

---

## The four ways to connect

| How you connect | What it means |
|---|---|
| **Bring your API key** | Paste a key from Anthropic or OpenAI — pay only for what you use, billed directly by that provider. |
| **Use your subscription** | Already pay for GitHub Copilot or Gemini CLI? Point Notesage at it — no extra cost. |
| **Run locally (Ollama)** | Install Ollama on your Mac and run open-source models with zero internet access. |
| **Bundled model** | Download a model file once; Notesage runs it entirely on your device, no accounts required. |

---

## Provider comparison

| Provider | Auth method | Cost model | Works offline | Tool calling | Vision (images) |
|---|---|---|---|---|---|
| **Anthropic (Claude)** | API key | Pay per use (Anthropic billing) | No | Yes | Yes |
| **OpenAI (GPT)** | API key | Pay per use (OpenAI billing) | No | Yes | Yes |
| **GitHub Copilot** | Your Copilot subscription | Included in your existing plan | No | Yes | Yes |
| **Gemini CLI** | API key or Google account | Free tier + pay per use | No | Yes | Yes |
| **Codex** | Codex subscription | Included in your plan | No | Yes | No |
| **Ollama** | Local install (free) | Free — runs on your hardware | Yes | Yes (model-dependent) | Yes (model-dependent) |
| **Bundled model** | Download once (free) | Free — runs on your hardware | Yes | Yes (model-dependent) | Yes (model-dependent) |

---

## Setting up each provider

### Anthropic (Claude)
1. Go to [console.anthropic.com](https://console.anthropic.com) and create an API key.
2. In Notesage: **Settings → Connections → Add Connection → Anthropic**.
3. Paste your key. Notesage stores it in your Mac's Keychain — never in a file.

### OpenAI (GPT)
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) and create a key.
2. In Notesage: **Settings → Connections → Add Connection → OpenAI**.
3. Paste your key.

### GitHub Copilot
1. Sign in to GitHub Copilot via **Settings → Connections → Add Connection → GitHub Copilot**.
2. Follow the device-code flow — Notesage opens GitHub in your browser and you enter the code shown.
3. Once connected, your Copilot subscription covers chat and inline completions in Notesage.

### Gemini CLI
1. Get a free API key at [aistudio.google.com](https://aistudio.google.com).
2. In Notesage: **Settings → Connections → Add Connection → Gemini**.
3. Paste your key.

### Ollama
1. Install Ollama from [ollama.ai](https://ollama.ai) and pull a model (e.g. `ollama pull llama3`).
2. In Notesage: **Settings → Connections → Add Connection → Ollama**.
3. Notesage detects Ollama automatically on your local machine.

### Bundled model (offline, no accounts)
1. In Notesage: **Settings → Local AI**.
2. Browse the model catalog and click **Download** next to any model.
3. Once downloaded, it's available immediately — no internet needed after that.

---

## ⚠️ Important notice for Claude Code (Anthropic ACP) users

**Effective June 15, 2026**, Anthropic changed how billing works for applications that use the Agent Client Protocol (ACP) — the integration that powers the "Claude Code" connection in Notesage.

**What changed:** Before June 15, 2026, usage by Notesage's Claude Code integration was drawn from Anthropic's shared credit pool for Claude Code products. After that date, each application must present its own API credentials, and usage is billed separately to the API key or account associated with Notesage — not to your Claude Code subscription credit pool.

**What you need to do:**
- If you connected Notesage to Claude Code before June 15, 2026 and relied on the shared credit pool, you'll need to add your own Anthropic API key under **Settings → Connections**.
- If you already have an Anthropic API key set up, no action is needed.

This change comes from Anthropic, not from Notesage. If you have questions about your billing, check [Anthropic's support documentation](https://support.anthropic.com).

---

## Choosing the right provider

- **Best quality for complex tasks:** Anthropic Claude or OpenAI GPT — top-tier reasoning, long context windows.
- **No cost, works offline:** Bundled model — great for everyday writing, summarisation, and Q&A.
- **Already paying for Copilot:** Use your GitHub Copilot connection — same subscription, no extra fees.
- **Maximum privacy:** Ollama or bundled model — nothing leaves your machine.

You can assign different providers to different tasks: for example, use a fast local model for inline text completions while routing chat to a more powerful cloud model. Configure this under **Settings → Connections → Routing**.
