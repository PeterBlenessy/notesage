# Connecting an AI provider

In-app setup guidance (more detailed than the marketing overview). Shown to people who are actually configuring a connection in **Settings → Connections**.

> Note: this is the detailed reference relocated out of the marketing content, which stays high-level. If you want a heads-up here about a provider's own billing/policy changes (e.g. how a provider bills agent usage), add it once it's confirmed against that provider's official documentation — don't publish unverified third-party policy claims.

---

## Ways to connect

There are four ways to bring AI into Notesage:

| How you connect | What it means | Best for |
|---|---|---|
| **Bring your API key** | Enter a key from Anthropic, OpenAI, or a compatible service | Pay-as-you-go users who want any model |
| **Use your subscription** | Connect Claude, Copilot, Gemini, or Codex via your existing subscription | People who already pay for an AI service |
| **Run locally** | Connect Ollama or another local server running on your computer | Offline users and privacy-first setups |
| **Bundled model** | Use a model that ships with Notesage — no setup, no account | Total beginners or offline fallback |

---

## Supported providers

| Provider | Auth method | Cost model | Works offline | Tool calling | Vision |
|---|---|---|---|---|---|
| **Anthropic (Claude)** | API key | Pay per use | No | Yes | Yes |
| **OpenAI** | API key | Pay per use | No | Yes | Yes |
| **GitHub Copilot** | Copilot subscription | Monthly subscription | No | Yes | Yes |
| **Gemini CLI** | Google account or API key | Free tier / pay per use | No | Yes | Yes |
| **Codex (OpenAI)** | Codex subscription | Monthly subscription | No | Yes | No |
| **Ollama** | None (runs locally) | Free (your hardware) | Yes | Yes | Model dependent |
| **Bundled model** | None (built in) | Free (your hardware) | Yes | Limited | Some models |

---

## Setting up each provider

### Anthropic (Claude)
1. Go to [console.anthropic.com](https://console.anthropic.com) and create an API key.
2. In Notesage, open **Settings → Connections → Add Connection → Anthropic**.
3. Paste your API key. Notesage stores it securely in your system keychain.

### OpenAI
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
Enable **Local AI** in Settings → Connections, then download a curated model. The catalog flags which models fit your Mac's memory, so you can pick one sized to your hardware. No internet connection is needed after download.
