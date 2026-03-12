# App Store Launch Readiness: Security Hardening & Submission Requirements

Research date: 2026-03-12
Notesage version: 0.19.0

Comprehensive audit of what Notesage needs to ship on the Mac App Store — covering security hardening, sandboxing, entitlements, credential storage, and submission requirements.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Infrastructure — What's Already in Place](#2-current-infrastructure)
3. [Security Hardening — Critical](#3-security-hardening--critical)
4. [Security Hardening — Medium](#4-security-hardening--medium)
5. [Security Hardening — Low](#5-security-hardening--low)
6. [Credential Storage](#6-credential-storage)
7. [App Sandbox & Entitlements](#7-app-sandbox--entitlements)
8. [Privacy Manifest](#8-privacy-manifest)
9. [Info.plist & Bundle Configuration](#9-infoplist--bundle-configuration)
10. [Code Signing & Distribution](#10-code-signing--distribution)
11. [App Store Connect Submission](#11-app-store-connect-submission)
12. [Technical Risks & Unknowns](#12-technical-risks--unknowns)
13. [Recommended PRDs](#13-recommended-prds)
14. [Appendix: File Reference](#14-appendix-file-reference)

---

## 1. Executive Summary

**Overall readiness: ~40%**

Notesage has strong fundamentals — well-designed process spawning, proper auto-updater signing, HTTPS enforcement for external APIs, and no shell injection vectors. However, several critical security gaps and missing App Store requirements block submission:

| Category | Status |
|----------|--------|
| Process spawning & IPC | Secure |
| Auto-updater | Secure |
| Git command execution | Secure |
| Script execution (skills) | Secure |
| Clipboard handling | Safe |
| API key storage | Plaintext in localStorage |
| Content Security Policy | Disabled |
| Asset protocol scope | Wide open (`**`) |
| FS capability scoping | Unscoped |
| DOCX viewer | XSS vulnerable |
| App sandbox entitlements | Missing entirely |
| Privacy Manifest | Missing |
| App Store signing identity | Not configured |
| Submission assets | Not prepared |

**Estimated work to launch:** 3-4 weeks across three workstreams (credentials, hardening, submission prep).

---

## 2. Current Infrastructure

### 2.1 What's Already Working

**Tauri v2 configuration** (`src-tauri/tauri.conf.json`):
- Bundle identifier: `com.notesage.app`
- Product name: "Notesage"
- macOS minimum version: 14.0 (Sonoma)
- Window: 1200x800 default, min 800x600, native titlebar
- Code signing fields present but null: `signingIdentity: null`, `entitlements: null`

**App icons** (`src-tauri/icons/`):
- `icon.icns` (macOS), `icon.ico` (Windows)
- PNGs: 32x32, 64x64, 128x128, 128x128@2x
- iOS/Android icons present for future mobile
- Need to verify 1024x1024 PNG exists for App Store listing

**Info.plist** (`src-tauri/Info.plist`):
- `NSSupportsAutomaticTermination: false`
- `NSAppSleepDisabled: true`
- `NSMicrophoneUsageDescription` declared

**Tauri capabilities** (`src-tauri/capabilities/default.json`):
- Core window management
- Filesystem: read/write files, read directories, create, mkdir, rename, remove
- Dialog operations
- HTTP scoped to `https://github.com/PeterBlenessy/notesage/**` (HTTPS-only, narrow)
- Updater, opener, process plugins

**CI/CD** (`.github/workflows/release.yml`):
- Automated macOS builds (aarch64-apple-darwin)
- Code signing via secrets: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`
- Notarization: `APPLE_ID`, `APPLE_PASSWORD`
- Auto-update signing via minisign
- Uploads to GitHub Releases

**Auto-updater** (`tauri.conf.json`):
- Minisign public key for signature verification
- HTTPS endpoint: `https://github.com/PeterBlenessy/notesage/releases/latest/download/latest.json`
- Tauri handles verification automatically

**Sidecar binary** (llama-server):
- Static-linked (no Homebrew dependencies)
- Built from source in CI
- `kill_on_drop(true)` cleanup
- Version tracked in `src-tauri/binaries/LLAMA_CPP_VERSION`

**Process spawning** (all Rust commands):
- All use direct `Command::new()` — no `sh -c` shell invocation
- Arguments passed as arrays, never concatenated
- `kill_on_drop(true)` on all subprocesses
- Proper cleanup in `RunEvent::Exit` hook

### 2.2 Security Audit: What's Already Secure

| Area | Files | Assessment |
|------|-------|------------|
| Git commands | `src-tauri/src/commands/git.rs` | Array-based args, no shell injection |
| Skill scripts | `src-tauri/src/commands/skills.rs` | Path canonicalization + traversal check, timeout enforcement (30-300s) |
| ACP agents | `src-tauri/src/commands/acp.rs` | Binary path validation via `which`, direct spawn |
| Copilot LSP | `src-tauri/src/commands/copilot_lsp.rs` | Hardcoded `--stdio` arg, no user input in command |
| Local inference | `src-tauri/src/commands/local_inference.rs` | Bundled binary, hardcoded flags |
| EPUB viewer | `src/components/editor/viewers/EpubViewer.tsx` | foliate-js Web Component with sandboxed iframes |
| PDF viewer | `src/components/editor/viewers/PdfViewer.tsx` | Canvas-based rendering via pdfjs-dist, no HTML execution |
| Plain text viewer | `src/components/editor/viewers/PlainTextViewer.tsx` | React text node (escaped), no `innerHTML` |
| Clipboard | Various | Only user-visible content copied, no API keys |
| Logging | `src/lib/logger.ts`, Rust commands | API keys never logged (verified via codebase grep) |
| HTTP/TLS | `src-tauri/src/commands/ai.rs` | All external APIs use HTTPS (Anthropic, OpenAI, GitHub, HuggingFace) |

---

## 3. Security Hardening — Critical

### 3.1 Content Security Policy (CSP) — DISABLED

**Location:** `src-tauri/tauri.conf.json`, line 29

**Current state:**
```json
"security": {
  "csp": null
}
```

**Impact:** No browser-level XSS protection. If malicious content is rendered (e.g., via DOCX viewer), scripts execute with full WebView privileges including access to Tauri IPC commands.

**Recommended CSP:**
```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: asset:;
font-src 'self' data:;
connect-src 'self' https://github.com;
media-src 'self';
worker-src 'self' blob:;
```

**Notes:**
- `'unsafe-inline'` for styles is likely necessary for Tailwind CSS runtime injection
- `'wasm-unsafe-eval'` needed if any WASM modules are used (pdfjs-dist, whisper-rs)
- `connect-src` should include only the update endpoint — AI API calls go through Tauri IPC, not browser fetch
- Testing required: EPUB viewer loads content into iframes which may need additional CSP directives

### 3.2 Asset Protocol Scope — Wide Open

**Location:** `src-tauri/tauri.conf.json`, lines 30-36

**Current state:**
```json
"assetProtocol": {
  "enable": true,
  "scope": {
    "allow": ["**"],
    "requireLiteralLeadingDot": false
  }
}
```

**Impact:** The WebView can read any file on the filesystem via `asset://` URLs. Combined with an XSS vulnerability, an attacker could exfiltrate sensitive files (`~/.ssh/id_rsa`, `~/.aws/credentials`, etc.).

**Recommended scope:**
```json
"assetProtocol": {
  "enable": true,
  "scope": {
    "allow": [
      "$APPDATA/**",
      "$HOME/Notesage/**",
      "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Notesage/**",
      "$HOME/.notesage/**"
    ],
    "requireLiteralLeadingDot": true
  }
}
```

**Challenge:** Notesage opens user-selected folders from anywhere on the filesystem. The asset protocol scope may need to be dynamic or include broader read access for user-opened directories. Research needed on whether Tauri supports dynamic scope expansion after user selects a folder via dialog.

### 3.3 DOCX Viewer XSS

**Location:** `src/components/editor/viewers/DocxViewer.tsx`, line ~202

**Current state:**
```tsx
<div
  ref={contentRef}
  dangerouslySetInnerHTML={{ __html: html }}
/>
```

**Impact:** mammoth.js converts DOCX to HTML but does NOT sanitize malicious content. A crafted DOCX with `<img onerror="...">` or `<script>` tags executes JavaScript in the app context with access to Tauri IPC.

**Attack vector:** User opens malicious DOCX file -> mammoth produces HTML with embedded JS -> `dangerouslySetInnerHTML` renders it -> JS executes with Tauri command access.

**Fix:** Add DOMPurify sanitization:
```tsx
import DOMPurify from 'dompurify';
const sanitized = DOMPurify.sanitize(html);
<div dangerouslySetInnerHTML={{ __html: sanitized }} />
```

**Dependency:** `dompurify` (~15KB gzipped). Well-maintained, widely used (50M+ weekly npm downloads).

### 3.4 Filesystem Capability Scoping — Unscoped

**Location:** `src-tauri/capabilities/default.json`

**Current state:**
```json
"permissions": [
  "fs:allow-read-text-file",
  "fs:allow-write-text-file",
  "fs:allow-read-dir",
  "fs:allow-exists",
  "fs:allow-create",
  "fs:allow-mkdir",
  "fs:allow-rename",
  "fs:allow-remove"
]
```

**Impact:** These permissions allow the frontend to read/write ANY file on the system through Tauri IPC. No path restrictions are applied.

**Challenge:** Same as asset protocol — Notesage needs to access user-selected folders anywhere. Tauri v2 supports scoped permissions with path patterns, but the app's open-any-folder design makes static scoping difficult.

**Possible approaches:**
1. **Dynamic scope expansion** — Start with `$HOME/.notesage/**` and `$APPDATA/**`, expand when user opens a folder via dialog
2. **Tauri scope manager** — Use `tauri-plugin-fs`'s scope management to add paths at runtime
3. **Accept broad scope with defense-in-depth** — Keep broad FS permissions but enforce CSP + sanitization so the frontend can't be tricked into malicious file operations

**Research needed:** How does Tauri v2 handle dynamic filesystem scope expansion? Does the dialog plugin automatically add selected paths to the FS scope?

---

## 4. Security Hardening — Medium

### 4.1 MCP Server Config Injection

**Location:** `src-tauri/src/commands/mcp.rs`, lines 595-602

**Current state:** MCP server configs from `.notesage/mcp.json` or imported from Claude Desktop/Cursor/VS Code specify arbitrary commands and arguments:
```json
{
  "command": "node",
  "args": ["--eval", "require('child_process').exec('malicious-command')"]
}
```

**Impact:** A malicious MCP config (crafted or imported from a compromised tool) could execute arbitrary commands.

**Mitigations:**
1. Show a warning dialog when importing MCP configs from other tools, listing the commands that will be executed
2. Log all MCP server spawning with full command + args
3. Optionally validate that command paths resolve to expected locations

### 4.2 Ollama Remote HTTP

**Location:** `src-tauri/src/commands/ai.rs`, `ai_streaming.rs`

**Current state:**
```rust
let base = ollama_url.as_deref().unwrap_or("http://localhost:11434");
```

**Impact:** If a user configures a remote Ollama URL with HTTP (not localhost), prompts and responses are transmitted unencrypted.

**Fix:**
```rust
if let Some(url) = ollama_url {
  if url.starts_with("http://") && !url.contains("localhost") && !url.contains("127.0.0.1") {
    return Err("Remote Ollama URLs must use HTTPS for security".to_string());
  }
}
```

### 4.3 mammoth.js Outdated

**Dependency:** `mammoth` v1.11.0 (last major update ~2019)

**Risks:**
- OOXML bomb attacks (malicious ZIP compression ratios in DOCX files)
- XXE (XML External Entity) injection in embedded content
- No active security patching

**Mitigations:**
1. Add file size validation before parsing (e.g., 50MB limit)
2. DOMPurify sanitization (addresses the output side — see 3.3)
3. Consider alternative DOCX renderers if mammoth.js remains unmaintained

### 4.4 Image Path Normalization

**Location:** `src/lib/image-utils.ts`, lines 13-66

**Current state:** Custom path normalization splits on `/` only:
```typescript
const parts = path.split("/");
```

**Impact:** On Windows, backslash separators bypass normalization, potentially allowing path traversal. Low risk on macOS (primary platform), but worth fixing for correctness.

**Fix:** Use Tauri's path APIs or handle both separators.

---

## 5. Security Hardening — Low

### 5.1 Debug Logging Warning

**Location:** `src/lib/logger.ts`, `src-tauri/src/lib.rs`

**Current state:** Users can enable debug logging in settings. While API keys are not logged (verified), prompts and responses could be. No user warning is shown.

**Recommendation:** Show a toast when debug logging is enabled: "Debug logging may capture your prompts and AI responses."

### 5.2 Vendored foliate-js Updates

**Location:** `public/foliate-js/`

**Current state:** Vendored from commit `6b11e174` (2025-11-29). No documented process for checking upstream security patches.

**Recommendation:** Document a monthly check against upstream `johnfactotum/foliate-js` for security-relevant changes.

---

## 6. Credential Storage

### 6.1 Current State: Plaintext localStorage

**Primary store:** `src/stores/connections-store.ts`
- Store name: `notesage-connections`
- Full persistence to localStorage via Zustand persist
- `Connection` objects contain `credentials.key` — the API key in **plaintext**
- No `partialize()` function to exclude sensitive fields

**Legacy store:** `src/stores/ai-store.ts`
- Store name: `notesage-ai-settings`
- `apiKeys: Record<string, string | undefined>` — plaintext, indexed by provider
- Deprecated but still used as migration fallback

**Where keys live on disk:**
- macOS: `~/Library/Application Support/com.notesage.app/` (WebView storage)
- Readable by any process running as the same user
- Visible in browser DevTools → Application → LocalStorage

### 6.2 Frontend-to-Backend Flow

```
User enters key in Settings UI
  → stored in connections-store (localStorage)
  → useAIOperations reads connection.credentials.key
  → passed to Tauri invoke('ai_chat_stream', { apiKey: key })
  → Rust injects into HTTP header (x-api-key / Authorization: Bearer)
```

The Rust backend:
- Receives key as a function parameter (per-request)
- Never persists credentials to disk
- Uses keys immediately for HTTP requests
- Does not cache keys in memory beyond function scope

### 6.3 Why This Blocks App Store

1. **Apple's security review** expects sensitive credentials to use macOS Keychain
2. **Privacy Manifest** requires declaring how credentials are stored — "plaintext in localStorage" is not acceptable
3. **Under sandbox**, the container is somewhat protected from other apps, but it's still plaintext on disk

### 6.4 Recommended Solution: OS Keychain via `keyring` Crate

**Approach:**

| Component | Change |
|-----------|--------|
| **Rust backend** | Add `store_credential(service, account, secret)` and `get_credential(service, account)` Tauri commands using the `keyring` crate |
| **connections-store** | Add `partialize()` to exclude `credentials.key` from localStorage persistence |
| **App startup** | Hydrate credential keys from Keychain into in-memory store |
| **Settings UI** | On save, write credential to Keychain; on delete, remove from Keychain |
| **Legacy migration** | On first launch with new system, move existing plaintext keys to Keychain, clear from localStorage |

**`keyring` crate benefits:**
- Cross-platform: macOS Keychain, Windows Credential Manager, Linux secret-service
- Simple API: `Entry::new(service, user)?.set_password(secret)?`
- Well-maintained (1M+ downloads)
- ~30 lines of Rust for both commands

**Alternative considered:** `tauri-plugin-stronghold` — encrypted vault file, Tauri-native, but more complex and not OS-native (Apple reviewers prefer Keychain).

**Security improvement:** After migration, the Rust backend could hold credentials in Tauri managed state (`State<CredentialCache>`) rather than receiving them from the frontend on every IPC call. This eliminates the credentials from the IPC transport entirely.

---

## 7. App Sandbox & Entitlements

### 7.1 Current State: No Entitlements

`tauri.conf.json` has `"entitlements": null`. No `.entitlements` file exists in the project.

App Store **requires** full sandbox (`com.apple.security.app-sandbox`).

### 7.2 Required Entitlements

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- App Sandbox (MANDATORY for App Store) -->
  <key>com.apple.security.app-sandbox</key>
  <true/>

  <!-- Network: AI API calls, model downloads, update checks -->
  <key>com.apple.security.network.client</key>
  <true/>

  <!-- Files: User-selected via dialog (Open Folder) -->
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>

  <!-- Files: Persist access across restarts (open tabs) -->
  <key>com.apple.security.files.bookmarks.app-scope</key>
  <true/>

  <!-- Files: Downloads folder (model downloads, PDF export) -->
  <key>com.apple.security.files.downloads.read-write</key>
  <true/>

  <!-- Microphone: Voice dictation and meeting recording -->
  <key>com.apple.security.device.audio-input</key>
  <true/>
</dict>
</plist>
```

### 7.3 Sandbox Concerns

**Sidecar binary (llama-server):**
- Sandboxed apps may restrict subprocess spawning
- The sidecar needs file access to `~/.notesage/models/llm/` — under sandbox this resolves to the app's container
- **Untested.** This is the single biggest technical risk.

**ACP/MCP agent subprocesses:**
- Claude Code, Codex, Copilot, Gemini CLI — spawned as child processes
- Under sandbox, these may need to be in the app's container or have inherited sandbox permissions
- **Untested.**

**Git operations:**
- Spawns system `git` binary
- Under sandbox, access to `/usr/bin/git` should be allowed, but file access for repos outside the container may be restricted to user-selected folders only

**iCloud integration:**
- Writing to `~/Library/Mobile Documents/com~apple~CloudDocs/Notesage/`
- May require `com.apple.security.application-groups` entitlement
- **Untested under sandbox.**

**`~/.notesage/` directory:**
- Skills, agents, models, research, whisper models all stored here
- Under sandbox, this path may not be accessible
- May need `com.apple.security.temporary-exception.files.absolute-path.read-write` (temporary exception — Apple may flag during review)
- Better approach: migrate to `~/Library/Application Support/com.notesage.app/` (sandbox-friendly container path)

### 7.4 Testing Plan

Before submission, every feature must be tested under full sandbox:

| Feature | Test |
|---------|------|
| Open folder via dialog | File tree loads, files readable |
| Save file | Content persists, no permission errors |
| Reopen tabs on restart | File bookmarks work across launches |
| AI chat (Anthropic/OpenAI) | API calls succeed through sandbox |
| Model download (HuggingFace) | Large file download to container works |
| llama-server sidecar | Spawns, loads model, serves completions |
| Voice dictation | Microphone access granted, Whisper runs |
| Git operations | Status, commit, branch switch work |
| iCloud sync | Move to/from iCloud folder succeeds |
| MCP servers | Spawn and communicate via stdio |
| ACP agents | Spawn, authenticate, stream responses |
| EPUB/PDF/DOCX viewing | Files load and render correctly |
| PDF export | Typst compilation + file save works |
| Auto-updater | Update check succeeds (or gracefully disabled for App Store) |

---

## 8. Privacy Manifest

### 8.1 Requirement

Apple requires `PrivacyInfo.xcprivacy` since macOS 14+ for apps that:
- Access sensitive APIs (file system, microphone, network)
- Collect or transmit user data
- Use tracking or analytics

### 8.2 Required Declarations

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <!-- File timestamp APIs (used for file tree display) -->
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>C617.1</string> <!-- Display to user -->
      </array>
    </dict>
    <!-- User defaults (Zustand persist to localStorage) -->
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array>
        <string>CA92.1</string> <!-- App functionality -->
      </array>
    </dict>
  </array>

  <!-- No tracking -->
  <key>NSPrivacyTracking</key>
  <false/>

  <!-- No tracking domains -->
  <key>NSPrivacyTrackingDomains</key>
  <array/>

  <!-- Data collection: None sent to developer -->
  <key>NSPrivacyCollectedDataTypes</key>
  <array/>
</dict>
</plist>
```

### 8.3 Network Endpoints to Document

While not part of the plist itself, Apple's review process requires explaining network access:

| Endpoint | Purpose | User-initiated? |
|----------|---------|-----------------|
| `https://api.anthropic.com` | AI chat (user's API key) | Yes |
| `https://api.openai.com` | AI chat (user's API key) | Yes |
| `https://huggingface.co` | Model downloads (GGUF, Whisper) | Yes |
| `https://github.com/PeterBlenessy/notesage/releases/` | Auto-update check | Automatic |
| `http://localhost:11434` | Ollama local server | Yes |
| `http://127.0.0.1:*` | Bundled llama-server | Automatic |

---

## 9. Info.plist & Bundle Configuration

### 9.1 Current Info.plist

```xml
<key>NSSupportsAutomaticTermination</key>
<false/>
<key>NSAppSleepDisabled</key>
<true/>
<key>NSMicrophoneUsageDescription</key>
<string>Notesage needs microphone access for voice dictation and meeting recording</string>
```

### 9.2 Missing Entries

```xml
<!-- App category (required for App Store) -->
<key>LSApplicationCategoryType</key>
<string>public.app-category.productivity</string>

<!-- Copyright notice -->
<key>NSHumanReadableCopyright</key>
<string>Copyright 2024-2026 Peter Blenessy. All rights reserved.</string>
```

### 9.3 Bundle Identifier

**Current:** `com.notesage.app`
**Required:** Must match Apple Developer Team prefix, e.g., `com.peterblenessy.notesage`
**Location:** `src-tauri/tauri.conf.json` → `identifier`

### 9.4 Version Management

**Current state:**
- `package.json`: `"version": "0.19.0"` — source of truth
- `src-tauri/tauri.conf.json`: `"version": "../package.json"` — references package.json
- `src-tauri/Cargo.toml`: `version = "0.1.0"` — independent crate version

**Missing:**
- `CFBundleVersion` (build number) — App Store requires incrementing build numbers for each submission, even with the same marketing version
- No automated build number management in CI

**Recommended:** Add build number generation in CI:
```yaml
# In release.yml
- name: Set build number
  run: echo "BUILD_NUMBER=$(date +%Y%m%d%H%M)" >> $GITHUB_ENV
```

Then reference in `tauri.conf.json` or pass as environment variable.

---

## 10. Code Signing & Distribution

### 10.1 Current CI Signing

The GitHub Actions workflow (`.github/workflows/release.yml`) uses:
- `APPLE_CERTIFICATE` — Developer ID certificate (base64)
- `APPLE_CERTIFICATE_PASSWORD` — Certificate password
- `APPLE_SIGNING_IDENTITY` — e.g., "Developer ID Application: Name (TEAM_ID)"
- `APPLE_TEAM_ID` — Apple Developer Team ID
- `APPLE_ID` + `APPLE_PASSWORD` — For notarization

**This is for direct distribution (GitHub Releases), NOT App Store.**

### 10.2 App Store Distribution Changes

| Setting | Direct (current) | App Store (needed) |
|---------|------------------|-------------------|
| Certificate type | Developer ID Application | 3rd Party Mac Developer Application |
| Installer cert | Developer ID Installer | 3rd Party Mac Developer Installer |
| Signing identity | `"Developer ID Application: ..."` | `"3rd Party Mac Developer Application: ..."` |
| Entitlements | Optional | Required (sandbox) |
| Notarization | Required | Not needed (Apple signs after review) |
| Distribution | `.dmg` via GitHub | `.pkg` via App Store Connect |

### 10.3 Dual Distribution Strategy

Maintain both distribution channels:
1. **Direct (GitHub):** Current setup, Developer ID signing, notarized `.dmg`, auto-updater
2. **App Store:** Separate CI job, App Store signing, sandbox entitlements, no auto-updater (Apple handles updates)

The auto-updater should be conditionally disabled in App Store builds since Apple manages updates. Detect via build flag or the absence of the updater endpoint.

### 10.4 Sidecar Binary Signing

**Critical question:** Does Tauri automatically sign bundled sidecar binaries (llama-server) with the same identity as the main app?

If not, the sidecar must be signed separately in CI before bundling. Unsigned code inside the `.app` bundle will be rejected by:
- Gatekeeper (direct distribution)
- App Store review (App Store distribution)

**Research needed:** Verify Tauri v2's sidecar signing behavior. Check `tauri-action` source for sidecar handling.

---

## 11. App Store Connect Submission

### 11.1 Required Assets

| Asset | Specification |
|-------|--------------|
| App icon | 1024x1024 PNG (no alpha, no rounded corners — Apple applies mask) |
| Screenshots | 1280x800 or 1440x900 for Mac App Store (minimum 1, max 10) |
| App preview video | Optional, 15-30 seconds, showing key features |
| Description | Up to 4000 characters |
| Subtitle | Up to 30 characters |
| Keywords | Up to 100 characters total, comma-separated |
| Privacy policy URL | Required — must be publicly accessible |
| Support URL | Required |
| Marketing URL | Optional |

### 11.2 Suggested App Store Metadata

**Name:** Notesage
**Subtitle:** AI-Powered Markdown Editor
**Category:** Productivity
**Age rating:** 4+ (no objectionable content)

**Keywords (100 chars max):** `markdown,editor,notes,AI,writing,rich text,tiptap,offline,local AI,privacy`

**Description draft outline:**
- Paragraph 1: What it is (rich text markdown editor with AI)
- Paragraph 2: Key features (multi-provider AI, voice dictation, EPUB/PDF, git)
- Paragraph 3: Privacy focus (local-first, offline AI, your data stays on your device)
- Paragraph 4: Technical highlights (Tauri, native performance, macOS integration)

### 11.3 Review Notes

Apple reviewers need context for unusual features. Include notes about:
- **Bundled llama-server binary:** "The app bundles a static inference engine for offline AI features. It runs as a local-only server on 127.0.0.1 and requires no network access."
- **Network access:** "Network connections are user-initiated for AI provider APIs (user provides their own API keys) and model downloads from Hugging Face."
- **Microphone access:** "Used for voice dictation and meeting recording/transcription. All processing is on-device via bundled Whisper models."
- **File system access:** "The app is a document editor that opens user-selected folders containing markdown files."

### 11.4 Privacy Policy Requirements

Must cover:
- What data is collected (none transmitted to developer)
- How API keys are stored (macOS Keychain after migration)
- Third-party services (Anthropic, OpenAI — user-initiated, user's own keys)
- On-device processing (Whisper transcription, local AI)
- No analytics or tracking

---

## 12. Technical Risks & Unknowns

### 12.1 High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **llama-server under sandbox** | Core feature may not work | Test immediately; may need to move model storage to app container |
| **`~/.notesage/` access under sandbox** | Skills, agents, research, models inaccessible | Migrate to `~/Library/Application Support/com.notesage.app/` |
| **ACP agent spawning under sandbox** | Agent-managed AI (Claude Code, Codex, etc.) may fail | Test; may need to defer agent features from App Store build |
| **Sidecar binary signing** | Unsigned binary = App Store rejection | Verify Tauri's sidecar signing; add manual signing step if needed |

### 12.2 Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Auto-updater in App Store build** | Apple may reject apps with self-update mechanisms | Conditionally disable updater for App Store builds |
| **Git binary access under sandbox** | Git features may not work | Test; may need to use `libgit2` instead of shelling out to `git` |
| **iCloud entitlements** | iCloud sync feature may require additional entitlements | Test; add `com.apple.security.application-groups` if needed |
| **Dynamic FS scope expansion** | Opening arbitrary folders may conflict with sandbox | Research Tauri's dialog-based scope expansion |

### 12.3 Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Review timeline** | App Store review takes 1-7 days; rejections add cycles | Prepare thorough review notes, test sandbox compliance early |
| **Build number management** | Must increment for each submission | Automate in CI |
| **Icon format** | May need specific format for App Store | Verify 1024x1024 PNG exists |

---

## 13. Recommended PRDs

Based on this research, three PRDs with clear dependency ordering:

### PRD 1: Secure Credential Storage

**Scope:** Migrate API keys from plaintext localStorage to macOS Keychain
**Key deliverables:**
- Rust commands using `keyring` crate: `store_credential`, `get_credential`, `delete_credential`
- `connections-store` `partialize()` to exclude credentials from persistence
- Startup hydration from Keychain to in-memory store
- Legacy migration (plaintext -> Keychain, clear localStorage)
- Optional: backend-held credentials via Tauri managed state

**Dependency:** None — can ship independently, benefits all users

### PRD 2: Security Hardening

**Scope:** Close all security gaps found in audit
**Key deliverables:**
- Enable CSP in `tauri.conf.json`
- Scope asset protocol to app-relevant directories
- Add DOMPurify sanitization for DOCX viewer
- Scope FS capabilities (or research dynamic scoping)
- Enforce HTTPS for remote Ollama URLs
- Add MCP config import validation/warnings
- File size validation for DOCX viewer
- Debug logging user warning

**Dependency:** None — can ship independently, benefits all users

### PRD 3: App Store Launch Preparation

**Scope:** Everything needed to submit to the Mac App Store
**Key deliverables:**
- Create `macos.entitlements` file with sandbox + required capabilities
- Create `PrivacyInfo.xcprivacy`
- Update `Info.plist` (category, copyright, build number)
- Update bundle identifier
- Add App Store signing to CI (separate job from direct distribution)
- Build number automation
- Conditionally disable auto-updater for App Store builds
- Sandbox compliance testing for all features
- Prepare App Store Connect assets (screenshots, description, privacy policy)
- Address `~/.notesage/` path migration for sandbox compatibility

**Dependency:** PRDs 1 and 2 should be completed first

---

## 14. Appendix: File Reference

### Files to Create

| File | Purpose |
|------|---------|
| `src-tauri/Entitlements.plist` | App sandbox entitlements |
| `src-tauri/PrivacyInfo.xcprivacy` | Privacy manifest |
| `docs/privacy-policy.md` | Privacy policy (to be hosted publicly) |

### Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/tauri.conf.json` | CSP, asset protocol scope, entitlements path, bundle identifier |
| `src-tauri/Info.plist` | Category, copyright, build number |
| `src-tauri/Cargo.toml` | Add `keyring` dependency |
| `src/stores/connections-store.ts` | `partialize()` to exclude credentials, Keychain integration |
| `src/stores/ai-store.ts` | Legacy key migration to Keychain |
| `src/components/editor/viewers/DocxViewer.tsx` | DOMPurify sanitization |
| `src-tauri/src/commands/ai.rs` | HTTPS enforcement for remote Ollama |
| `src-tauri/src/commands/mcp.rs` | Config import validation |
| `.github/workflows/release.yml` | App Store signing job, build number automation |
| `package.json` | Add `dompurify` + `@types/dompurify` |

### Files to Audit Under Sandbox

| File | Concern |
|------|---------|
| `src-tauri/src/commands/local_inference.rs` | Sidecar spawning, model file access |
| `src-tauri/src/commands/acp.rs` | Agent subprocess spawning |
| `src-tauri/src/commands/git.rs` | System git binary access |
| `src-tauri/src/commands/skills.rs` | Script execution under sandbox |
| `src-tauri/src/commands/mcp.rs` | MCP server subprocess spawning |
| `src-tauri/src/commands/transcription.rs` | Microphone access, whisper model access |
| `src/lib/scan-icloud-projects.ts` | iCloud directory access |
