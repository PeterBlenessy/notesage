mod commands;
mod export;
mod index;
mod tray;

// Re-exports for integration tests under `tests/`. Kept narrow — only the
// primitives tests need to drive the real sandbox plumbing from outside the
// crate (see `tests/sandbox_isolation.rs`, `tests/watcher_integration.rs`).
pub use commands::sandbox;
pub use commands::sandbox_monitor;
pub use commands::watcher;
// Exposed for the `calibrate_model_fit` example, which links the engine
// directly so the fit/speed math stays single-source (no JS reimplementation).
pub use commands::model_fit;

use commands::*;
use index::IndexState;
use tauri::{Emitter, Manager, RunEvent};
use tauri_plugin_log::{Target, TargetKind, RotationStrategy, TimezoneStrategy};

#[tauri::command]
fn open_devtools(webview_window: tauri::WebviewWindow) {
    webview_window.open_devtools();
}

#[tauri::command]
fn set_log_level(level: String) {
    let filter = match level.as_str() {
        "error" => log::LevelFilter::Error,
        "warn" => log::LevelFilter::Warn,
        "info" => log::LevelFilter::Info,
        "debug" => log::LevelFilter::Debug,
        _ => log::LevelFilter::Warn,
    };
    log::set_max_level(filter);
    log::info!(target: "notesage::settings", "Log level set to {}", level);
}

// Build-time telemetry keys. Injected by CI for release builds via GitHub
// Actions secrets (see `.github/workflows/release.yml` + `.env.example`):
//   NOTESAGE_SENTRY_DSN     → crash/error reporting (Sentry, DSN-swappable to GlitchTip)
//   NOTESAGE_APTABASE_KEY   → privacy-first usage analytics (Aptabase)
// `option_env!` resolves to `None` when the var is unset at compile time, so a
// no-key local/dev build compiles and runs as a clean telemetry no-op — never
// `env!` (compile error) and never a runtime panic.
#[cfg_attr(target_os = "ios", allow(dead_code))]
const SENTRY_DSN: Option<&str> = option_env!("NOTESAGE_SENTRY_DSN");
const APTABASE_KEY: Option<&str> = option_env!("NOTESAGE_APTABASE_KEY");

/// Build the process-wide multi-threaded Tokio runtime that `run()` enters
/// before the Tauri builder starts. Entering this runtime on the main thread is
/// what gives plugin `setup` hooks a reactor for `tokio::spawn`
/// (tauri-plugin-aptabase's `start_polling`); without it the app panics at
/// startup with "there is no reactor running" — see `run()` and the regression
/// test below.
fn build_app_runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Runtime::new().expect("failed to build Tokio runtime")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Establish and ENTER a Tokio runtime for the whole process BEFORE the
    // Tauri builder runs. Some plugins call the global `tokio::spawn` from their
    // `setup` hook (notably `tauri-plugin-aptabase`'s `start_polling`), which
    // panics with "there is no reactor running, must be called from the context
    // of a Tokio 1.x runtime" unless a runtime is entered on the main thread at
    // plugin-setup time. Tauri's default runtime is not entered there, so we
    // create one, hand it to Tauri (`async_runtime::set`) so everything shares a
    // single runtime, and keep the enter-guard alive for the app's lifetime.
    //
    // This only manifested once `NOTESAGE_APTABASE_KEY` was wired into release
    // builds (v0.46.0-alpha.17+): without the key the Aptabase plugin is never
    // registered, so the panic never fired — which is why dev/local builds and
    // earlier alphas were unaffected. `runtime` + `_runtime_guard` are held as
    // locals through the blocking `builder.run(...)` call below.
    // reqwest 0.13's rustls backend requires a process-default CryptoProvider
    // and panics "No provider set" when building any client without one. On
    // desktop the panic lands in a worker thread and hides; on iOS, Tauri's
    // dev-server proxy builds a client during startup and the panic kills the
    // app before the first frame. Install ring exactly once, up front.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let runtime = build_app_runtime();
    tauri::async_runtime::set(runtime.handle().clone());
    let _runtime_guard = runtime.enter();

    // Build the Sentry client ONCE up front so the panic hook installs exactly
    // once. The returned guard is `mem::forget`-ed (we keep the client alive for
    // the whole process via `telemetry::set_sentry_client`); dropping it would
    // close the client. Crash egress is then gated at runtime by binding /
    // unbinding the client on the Hub (`telemetry::set_sentry_enabled`), so the
    // crash toggle takes effect immediately with no second panic-hook install.
    //
    // `None` DSN → no client is built → all telemetry helpers are clean no-ops.
    // Not compiled for iOS at all: the sentry crates are absent from that
    // target (#587), so this block would not even name-resolve there.
    #[cfg(not(target_os = "ios"))]
    if let Some(dsn) = SENTRY_DSN {
        let guard = sentry::init((
            dsn,
            sentry::ClientOptions {
                release: Some(env!("CARGO_PKG_VERSION").into()),
                send_default_pii: false,
                // Disable breadcrumb capture entirely: default integrations
                // collect log/console breadcrumbs, and Notesage logs absolute
                // file paths heavily (`[perf:doc-load]`, startup logs, …). With
                // none collected there is no breadcrumb PII channel to scrub.
                max_breadcrumbs: 0,
                before_send: Some(std::sync::Arc::new(|event| {
                    Some(telemetry::scrub_event(event))
                })),
                ..Default::default()
            },
        ));
        // Retain the client so runtime toggles can re-bind it without re-init.
        if let Some(client) = sentry::Hub::current().client() {
            telemetry::set_sentry_client(client);
        }
        // `sentry::init` binds the client ON by default. Honour persisted
        // startup consent: keep it bound only if crash reporting is enabled,
        // otherwise unbind immediately (egress off until the user opts in).
        //
        // Ordering note: the panic hook is installed by init() above and consent
        // is applied here, immediately after. The only gap is this synchronous
        // `read_consent()` fs read — a panic in that window is a startup crash
        // worth capturing regardless of saved preference, so the race is benign.
        let consent = telemetry::read_consent();
        telemetry::set_sentry_enabled(consent.crash);
        // Keep the guard alive for the process lifetime — the client is owned by
        // `SENTRY_CLIENT` now, and dropping the guard would close it.
        std::mem::forget(guard);
    }

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init());

    // iOS native bridge (security-scoped library access). A plugin crate with
    // its own Swift Package — see crates/tauri-plugin-notesage-ios — because
    // that is the only shape where Tauri resolves the Swift `@_cdecl` entry
    // point at link time.
    #[cfg(target_os = "ios")]
    {
        builder = builder.plugin(tauri_plugin_notesage_ios::init());
    }

    // Desktop-only plugins. `tauri_plugin_window_state` restores window
    // geometry and `tauri_plugin_autostart` installs a LaunchAgent — neither
    // concept exists on iOS, where both crates' APIs are compiled out.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_window_state::Builder::new().build())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ));
    }

    // Telemetry — usage analytics (Aptabase). Registered unconditionally when a
    // build-time key is present; the plugin emits nothing until the frontend
    // calls `trackEvent`, so the consent gate lives at the JS `track()` helper.
    // No key (every local/dev build) → skip registration cleanly, no panic.
    match APTABASE_KEY {
        None => {
            // Expected on every local/dev build (no build-time key) — info, not warn.
            log::info!(
                target: "notesage::telemetry",
                "Usage telemetry disabled: no build-time Aptabase key."
            );
        }
        Some(key) => {
            // Diagnose the key WITHOUT logging it (the key is a secret; the region
            // segment is not). The middle `A-<REGION>-<id>` segment decides the
            // ingest host inside the plugin's config: US/EU → cloud, DEV →
            // http://localhost:3000, SH → needs a host we don't pass. A
            // DEV/SH/malformed key silently routes nowhere, so surface it at warn.
            let parts: Vec<&str> = key.split('-').collect();
            let region = parts.get(1).copied().unwrap_or("");
            match (parts.len(), region) {
                (3, "US") | (3, "EU") => log::info!(
                    target: "notesage::telemetry",
                    "Usage telemetry enabled (Aptabase region {region}, cloud ingest)."
                ),
                (3, "DEV") => log::warn!(
                    target: "notesage::telemetry",
                    "Aptabase key region is DEV → ingest is http://localhost:3000; \
                     events will NOT reach the cloud. Set NOTESAGE_APTABASE_KEY to an A-US-/A-EU- key."
                ),
                (3, "SH") => log::warn!(
                    target: "notesage::telemetry",
                    "Aptabase key is self-hosted (SH) but no host is configured → tracking disabled."
                ),
                _ => log::warn!(
                    target: "notesage::telemetry",
                    "Aptabase key is malformed (expected A-<REGION>-<id>) → tracking disabled."
                ),
            }
            // iOS has no aptabase plugin (dependency is gated off in
            // Cargo.toml — mobile ships no usage telemetry). `key` is still
            // read above so the diagnostics stay identical across platforms.
            #[cfg(not(target_os = "ios"))]
            {
                builder = builder.plugin(tauri_plugin_aptabase::Builder::new(key).build());
            }
            #[cfg(target_os = "ios")]
            let _ = key;
        }
    }

    // Telemetry — crash/error reporting (Sentry). Registered only when the
    // client was successfully built above (DSN present). The plugin injects
    // `@sentry/browser` and routes frontend errors through Rust via `invoke`,
    // so frontend egress rides the Rust SDK — no widening of the JS HTTP
    // capability surface. Runtime crash-consent gating is handled by binding /
    // unbinding the client on the Hub (`telemetry::set_sentry_enabled`).
    #[cfg(not(target_os = "ios"))]
    if let Some(client) = telemetry::sentry_client() {
        builder = builder.plugin(tauri_plugin_sentry::init(&client));
    }

    // WebDriver plugin for real E2E testing (only when compiled with `--features e2e-testing`)
    #[cfg(feature = "e2e-testing")]
    {
        builder = builder.plugin(tauri_plugin_webdriver::init());
    }

    let builder = builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("notesage".into()),
                    }),
                ])
                .rotation_strategy(RotationStrategy::KeepOne)
                .max_file_size(5_000_000) // 5MB per file
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .level(log::LevelFilter::Debug)
                .build(),
        )
        .manage(WatcherState::new())
        .manage(AcpState::new())
        .manage(CopilotLspState::new())
        .manage(McpState::new())
        .manage(TranscriptionState::new())
        .manage(LocalInferenceState::new())
        .manage(AiStreamState::new())
        .manage(AgentManagerState::new())
        .manage(NetworkProxyState::new())
        .manage(SandboxMonitorState::new())
        .manage(IndexState::new())
        .manage(tray::TrayState::new())
        .manage(html_preview::HtmlPreviewState::new())
        .manage(AutomationSchedulerState::new())
        // Serves the HTML viewer's sandboxed-iframe documents from a real origin
        // with their own (empty) CSP, instead of a `blob:` URL that inherits the
        // app's hardened CSP and gets blanked by `frame-ancestors 'none'`. See
        // commands/html_preview.rs for the full rationale.
        .register_uri_scheme_protocol("htmlpreview", |ctx, request| {
            html_preview::handle_request(ctx, request)
        })
        ;

    // iOS registers ONLY the mobile shell's command surface. The desktop list
    // below contains broad write/exec/credential commands (`write_file` on
    // arbitrary absolute paths, `delete_path`, `get_credential`,
    // `acp_agent_spawn`, `run_in_terminal`, …) that the mobile shell never
    // calls — but "the frontend doesn't call it" is not a security boundary.
    // Gating them out of the iOS binary keeps the documented posture real at
    // the IPC layer. Since #586 the posture is "reads + three allowlisted
    // note-editing writes", not read-only: `ios_write_file` /
    // `ios_create_file` / `ios_create_directory` are library-root-confined
    // (sanitized relative paths, no delete/rename/exec) — an XSS-class bug in
    // the mobile WebView can at worst scribble text inside the granted
    // Notesage folder, never touch credentials, arbitrary paths, or spawn
    // anything.
    #[cfg(target_os = "ios")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        ios_pick_library_folder,
        ios_get_library_grant,
        ios_clear_library_grant,
        ios_list_directory,
        ios_read_file,
        ios_read_binary,
        ios_write_file,
        ios_create_file,
        ios_create_directory,
        ios_rename_file,
        ios_delete_file,
        ios_move_file,
        ios_quick_look,
        ios_thumbnail,
        ios_inline_article_images,
        ios_find_upgradable_articles,
        ios_article_thumbnail,
        ios_text_prompt,
        ios_content_ready,
        ios_context_menu,
        ios_entry_menu,
        ios_ensure_directory,
        ios_set_chrome,
            ios_present_report,
            ios_dismiss_report,
            ios_find_in_report,
            ios_share_file,
            ios_ensure_downloaded,
            ios_stat_file,
            ios_speech_start,
            ios_speech_pause,
            ios_speech_resume,
            ios_speech_stop,
            ios_speech_skip,
            ios_speech_set_rate,
            ios_speech_state,
            ios_speech_voices,
            ios_speech_set_voice,
        render_markdown_fragment,
        repair_html_doctype,
        article_source_url,
        article_card_meta,
        ios_article_card_meta,
        fetch_page_html,
        splice_article_header,
        html_preview_register,
        html_preview_unregister,
        log_frontend,
        set_log_level,
    ]);

    #[cfg(not(target_os = "ios"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
            open_devtools,
            set_log_level,
            read_file,
            read_binary_file,
            write_file,
            list_directory,
            list_files_shallow,
            create_file,
            create_directory,
            copy_file,
            copy_directory,
            rename_path,
            list_automations,
            save_automation,
            delete_automation,
            validate_automation,
            resolve_automation_write_path,
            set_automations_enabled,
            reload_automation_schedule,
            delete_path,
            path_exists,
            allow_asset_dir,
            ios_pick_library_folder,
            ios_get_library_grant,
            ios_clear_library_grant,
            ios_list_directory,
            ios_read_file,
            ios_read_binary,
            ios_write_file,
            ios_create_file,
            ios_create_directory,
            ios_rename_file,
            ios_delete_file,
            ios_move_file,
            ios_quick_look,
            ios_thumbnail,
            ios_inline_article_images,
            ios_find_upgradable_articles,
            ios_article_thumbnail,
            ios_text_prompt,
            ios_content_ready,
            ios_context_menu,
            ios_entry_menu,
        ios_entry_menu,
            ios_ensure_directory,
        ios_ensure_directory,
        ios_context_menu,
        ios_entry_menu,
        ios_ensure_directory,
        ios_content_ready,
        ios_context_menu,
        ios_entry_menu,
        ios_ensure_directory,
            ios_set_chrome,
            ios_present_report,
            ios_dismiss_report,
            ios_find_in_report,
            ios_share_file,
            ios_ensure_downloaded,
            ios_stat_file,
            ios_speech_start,
            ios_speech_pause,
            ios_speech_resume,
            ios_speech_stop,
            ios_speech_skip,
            ios_speech_set_rate,
            ios_speech_state,
            ios_speech_voices,
            ios_speech_set_voice,
            open_folder_dialog,
            open_file_dialog,
            run_in_terminal,
            ai_generate_text,
            ai_chat,
            ai_chat_stream,
            ai_chat_stream_cancel,
            ollama_fim_completion,
            openai_completions_fim,
            local_bundled_fim,
            list_models,
            ollama_model_supports_vision,
            get_home_dir,
            reveal_in_finder,
            git_check_available,
            git_is_repo,
            git_init,
            git_get_config,
            git_set_config,
            git_status,
            git_branch_current,
            git_branch_list,
            git_branch_switch,
            git_stage,
            git_unstage,
            git_commit,
            git_diff_files,
            git_diff_file,
            git_worktree_list,
            export_pdf,
            export_pptx,
            export_docx,
            render_html,
            render_markdown_preview,
            render_markdown_fragment,
            repair_html_doctype,
            save_binary_file,
            import_pptx_template,
            list_pptx_templates,
            delete_pptx_template,
            migrate_user_content_paths,
            watch_directory,
            unwatch_directory,
            mark_self_write,
            clear_self_write,
            get_icloud_path,
            read_sync_settings,
            write_sync_settings,
            migrate_to_icloud,
            migrate_from_icloud,
            migrate_quick_notes,
            telemetry_apply_consent,
            agent_resolve_binary,
            agent_install,
            agent_uninstall,
            agent_check_updates,
            agent_update,
            commands::local_agent::local_agent_write_config,
            acp_agent_check_availability,
            acp_agent_spawn,
            acp_agent_authenticate,
            acp_agent_exists,
            acp_is_agent_alive,
            acp_agent_stop,
            acp_agent_reconnect,
            acp_agent_smoke_test,
            acp_session_new,
            acp_session_load,
            acp_session_prompt,
            acp_supports_images,
            acp_session_cancel,
            acp_session_set_mode,
            acp_session_set_config_option,
            acp_session_close,
            acp_session_list,
            acp_session_resume,
            acp_session_fork,
            acp_permission_respond,
            copilot_lsp_check_availability,
            copilot_lsp_start,
            copilot_lsp_stop,
            copilot_lsp_status,
            copilot_lsp_sign_in,
            copilot_lsp_finish_auth,
            copilot_lsp_did_open,
            copilot_lsp_did_change,
            copilot_lsp_did_close,
            copilot_lsp_did_focus,
            copilot_lsp_request_completion,
            copilot_lsp_did_show_completion,
            copilot_lsp_accept_completion,
            copilot_lsp_conversation_create,
            copilot_lsp_conversation_turn,
            copilot_lsp_conversation_destroy,
            copilot_lsp_conversation_models,
            copilot_lsp_context_response,
            copilot_lsp_tool_result,
            copilot_lsp_tool_confirmation_response,
            // SQLite document index
            index::index_init,
            index::index_file,
            index::index_rebuild,
            index::index_reset,
            index::index_tags,
            index::index_tag_occurrences,
            index::index_mentions,
            index::index_mention_occurrences,
            index::index_search_research,
            index::index_tasks,
            index::index_toggle_task,
            index::index_goals,
            index::index_search_content,
            index::index_search_filenames,
            index::index_stats,
            index::get_backlinks,
            index::get_outlinks,
            index::get_broken_links,
            index::resolve_wikilink,
            discover_skills,
            extract_skill_tools,
            read_skill_content,
            execute_skill_script,
            hash_skill_script,
            read_agent_instructions,
            extract_bundled_skills,
            discover_agents,
            read_agent_content,
            cleanup_bundled_agents,
            mcp_start_server,
            mcp_validate_server,
            mcp_stop_server,
            mcp_restart_server,
            mcp_list_tools,
            mcp_call_tool,
            mcp_get_server_status,
            mcp_discover_configs,
            mcp_import_configs,
            mcp_save_config,
            mcp_check_import_sources,
            mcp_catalog_list,
            mcp_oauth_status,
            mcp_oauth_logout,
            mcp_oauth_authorize,
            // Logging & diagnostics
            log_frontend,
            get_log_path,
            clear_logs,
            get_log_size,
            collect_diagnostics,
            // State persistence
            store_read,
            store_read_batch,
            store_write,
            store_delete,
            // Health check
            ping,
            health_check,
            // Voice transcription
            start_recording,
            pause_recording,
            resume_recording,
            stop_recording,
            transcribe_file,
            list_whisper_models,
            download_whisper_model,
            cancel_model_download,
            delete_whisper_model,
            // Local AI inference
            get_system_memory,
            list_local_models,
            download_local_model,
            cancel_local_model_download,
            delete_local_model,
            add_custom_local_model,
            remove_custom_local_model,
            search_huggingface_models,
            fetch_hf_model_details,
            start_local_server,
            stop_local_server,
            get_local_server_status,
            get_local_server_log,
            start_completion_server,
            stop_completion_server,
            get_completion_server_status,
            check_llama_server_available,
            // Model metadata
            get_model_metadata,
            get_runtime_model_metadata,
            // Hardware-aware model recommendation
            model_fit::hardware::detect_hardware_profile,
            model_fit::estimate_model_fit,
            model_fit::read_gguf_capabilities,
            get_local_server_rss,
            // Actions dashboard
            scan_actions,
            // Network sandboxing proxy
            network_domain_respond,
            network_proxy_status,
            network_default_domains,
            // Secure credential storage
            store_credential,
            get_credential,
            delete_credential,
            migrate_credentials,
            // Web search
            web_search,
            // Link preview metadata
            fetch_link_metadata,
            // System font enumeration
            list_system_fonts,
            // System accent color bridge (macOS NSColor.controlAccentColor)
            get_system_accent_color,
            // System tray
            tray::update_tray_badge,
            tray::update_tray_recent,
            tray::set_tray_visible,
            tray::set_close_to_tray,
            tray::show_main_window_command,
            html_preview_register,
            html_preview_unregister,
        ]);

    builder
        .setup(|app| {
            // Log startup at Info before restricting to Warn — this line always appears.
            log::info!(target: "notesage::lifecycle", "Notesage starting up (version {})", app.package_info().version);
            // Default to Warn until user raises it in Settings via set_log_level().
            log::set_max_level(log::LevelFilter::Warn);

            // Kill orphaned agent processes from previous sessions that weren't cleaned up
            // (e.g. app was force-quit or crashed). PID-file based with identity
            // verification — the old system-wide `pkill -f claude-agent-acp` also
            // killed matching processes owned by OTHER apps (a terminal Claude Code
            // session, another editor's ACP agent).
            acp::kill_orphaned_acp_agents();
            // Kill orphaned llama-server by PID file — NOT pkill, which would kill
            // llama-server instances from other apps (Ollama, LM Studio, etc.) and
            // race with the frontend's auto-start after app updates.
            local_inference::kill_orphaned_servers();
            sandbox::cleanup_legacy_profiles();
            log::debug!(target: "notesage::lifecycle", "Cleaned up orphaned agent processes");

            // Set up system tray
            #[cfg(desktop)]
            if let Err(e) = tray::setup_tray(app) {
                log::error!(target: "notesage::tray", "Failed to set up tray: {}", e);
            }

            // Start the automations scheduler tick loop (gated on the master
            // enable flag; emits `automation-due` for the frontend runner).
            automations::spawn_scheduler(app.handle().clone());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                RunEvent::Exit => {
                    log::info!(target: "notesage::lifecycle", "App exiting — stopping child processes");
                    // Stop all ACP agent subprocesses
                    app_handle.state::<AcpState>().stop_all_sync();
                    // Stop all network proxies (after ACP agents so connections close first)
                    app_handle.state::<NetworkProxyState>().stop_all_sync();
                    // Stop all MCP server subprocesses
                    app_handle.state::<McpState>().stop_all_sync();
                    // Stop local inference server
                    app_handle.state::<LocalInferenceState>().stop_sync();
                    // Stop sandbox violation monitor
                    app_handle.state::<SandboxMonitorState>().stop_sync();
                }
                RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } => {
                    if label == "main" && tray::is_close_to_tray(app_handle) {
                        // Hide window instead of closing when close-to-tray is enabled
                        api.prevent_close();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.hide();
                        }
                        log::debug!(target: "notesage::tray", "Window hidden to tray");
                    }
                }
                #[cfg(target_os = "macos")]
                RunEvent::Opened { urls } => {
                    // Handle file associations — macOS sends file:// URLs when opening .md files
                    let paths: Vec<String> = urls
                        .iter()
                        .filter_map(|url| {
                            if url.scheme() == "file" {
                                url.to_file_path().ok().map(|p| p.to_string_lossy().into_owned())
                            } else {
                                None
                            }
                        })
                        .collect();
                    if !paths.is_empty() {
                        log::info!(target: "notesage::lifecycle", "File association open: {:?}", paths);
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.emit("open-files", paths);
                        }
                    }
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression for the v0.46.0-alpha.17/18 startup crash: tauri-plugin-aptabase
    /// calls `tokio::spawn` from its plugin `setup` hook, which panics with
    /// "there is no reactor running, must be called from the context of a Tokio
    /// 1.x runtime" unless a runtime is ENTERED on the main thread before the
    /// Tauri builder runs. This proves `build_app_runtime()` + `enter()` is the
    /// mechanism that prevents it.
    ///
    /// This test only exercises the runtime mechanism. The end-to-end guard —
    /// actually launching a build with `NOTESAGE_APTABASE_KEY` set so the plugin
    /// registers — lives in CI (`.github/workflows/test.yml`), because the plugin
    /// is never registered in a keyless test/dev build.
    #[test]
    fn entered_app_runtime_provides_a_reactor_for_plugin_setup() {
        // Failure precondition: with no runtime entered on this thread, there is
        // no reactor — exactly the state that made aptabase's `tokio::spawn` panic.
        assert!(
            tokio::runtime::Handle::try_current().is_err(),
            "test thread must start with no entered runtime",
        );

        let rt = build_app_runtime();
        {
            let _guard = rt.enter();
            // A reactor is now available on this thread …
            assert!(
                tokio::runtime::Handle::try_current().is_ok(),
                "entering the app runtime must provide a reactor",
            );
            // … so the spawn that aptabase's `start_polling` performs no longer
            // panics. `spawn` returning a handle (rather than unwinding) is the
            // assertion; the task itself is a no-op.
            let _join = tokio::spawn(async {});
        }
    }
}
