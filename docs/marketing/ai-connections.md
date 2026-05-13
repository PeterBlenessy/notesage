# AI Connections

Notesage works with all the AI services you already use. You don't need a new account — just connect what you have.

---

## How You Can Connect

There are four ways to bring AI into Notesage:

| How you connect | What it means | Best for |
|---|---|---|
| **Bring your API key** | Enter a key from Anthropic, OpenAI, or a compatible service | Pay-as-you-go users who want any model |
| **Use your subscription** | Connect Claude, Copilot, Gemini, or Codex via your existing subscription | People who already pay for an AI service |
| **Run locally** | Connect Ollama or another local server running on your computer | Offline users and privacy-first setups |
| **Bundled model** | Use a model that ships with Notesage — no setup, no account | Total beginners or offline fallback |

---

## Supported Providers

| Provider | Auth method | Cost model | Works offline | Tool calling | Vision |
|---|---|---|---|---|---|
| **Anthropic (Claude)** | API key | Pay per use | No | Yes | Yes |
| **OpenAI (GPT-4o, etc.)** | API key | Pay per use | No | Yes | Yes |
| **GitHub Copilot** | Copilot subscription | Monthly subscription | No | Yes | Yes |
| **Gemini CLI** | Google account or API key | Free tier / pay per use | No | Yes | Yes |
| **Codex (OpenAI)** | Codex subscription | Monthly subscription | No | Yes | No |
| **Ollama** | None (runs locally) | Free (your hardware) | Yes | Yes | Model dependent |
| **Bundled model** | None (built in) | Free (your hardware) | Yes | Limited | Some models |

---

## Setting Up Each Provider

### Anthropic (Claude)
1. Go to [console.anthropic.com](https://console.anthropic.com) and create an API key.
2. In Notesage, open **Settings → Connections → Add Connection → Anthropic**.
3. Paste your API key. Notesage stores it securely in your system keychain.

### OpenAI (GPT-4o and friends)
1. Go to [platform.openai.com](https://platform.openai.com) and create an API key.
2. In Notesage, open **Settings → Connections → Add Connection → OpenAI**.
3. Paste your API key.

### GitHub Copilot
Connect your Copilot subscription in two ways:
- **For chat and agents:** Add a **Copilot (CLI)** connection. Notesage opens a sign-in flow in your browser.
- **For AI completions in the editor:** Add a **Copilot (LSP)** connection for ghost-text suggestions as you type.

### Gemini CLI
Add a **Gemini CLI** connection. You can sign in with a Google account or enter an API key from [aistudio.google.com](https://aistudio.google.com).

### Codex
Add a **Codex** connection and sign in with your OpenAI account that has Codex access.

### Ollama
1. Install Ollama from [ollama.com](https://ollama.com) and pull a model (e.g. `ollama pull llama3.2`).
2. In Notesage, add an **Ollama** connection. The default address `http://localhost:11434` works out of the box.

### Bundled model
Enable **Local AI** in Settings → Connections. Download one of the curated models (a small download — most are under 5 GB). No internet connection is needed after download.

---

## ⚠️ Important notice for Claude Code (ACP) users

**Effective June 15, 2026**, Anthropic is changing how Claude Code usage is billed when accessed through agent connections (ACP). Previously, usage flowed from your individual Claude account. After June 15, 2026, ACP usage will be drawn from a **credit pool** tied to your organisation or team plan instead.

**What this means for you:**
- If you use Claude Code via Notesage's agent connection, your usage will be billed against your team's shared credit pool after June 15, 2026.
- If you are on an individual Claude plan without an organisation, check Anthropic's documentation to understand how this change applies to your account.
- No action is needed inside Notesage — the connection settings remain the same.

For up-to-date information, see [Anthropic's billing documentation](https://docs.anthropic.com).

---

## Which provider should I choose?

- **Best output quality:** Anthropic Claude or OpenAI GPT-4o.
- **I already pay for Copilot:** Use the GitHub Copilot connection — no extra cost.
- **Privacy matters most:** Ollama or the bundled model. Your text never leaves your device.
- **Just getting started:** Try the bundled model — no account, no key, no cost.
