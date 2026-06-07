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
const SENTRY_DSN: Option<&str> = option_env!("NOTESAGE_SENTRY_DSN");
const APTABASE_KEY: Option<&str> = option_env!("NOTESAGE_APTABASE_KEY");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Build the Sentry client ONCE up front so the panic hook installs exactly
    // once. The returned guard is `mem::forget`-ed (we keep the client alive for
    // the whole process via `telemetry::set_sentry_client`); dropping it would
    // close the client. Crash egress is then gated at runtime by binding /
    // unbinding the client on the Hub (`telemetry::set_sentry_enabled`), so the
    // crash toggle takes effect immediately with no second panic-hook install.
    //
    // `None` DSN → no client is built → all telemetry helpers are clean no-ops.
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
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ));

    // Telemetry — usage analytics (Aptabase). Registered unconditionally when a
    // build-time key is present; the plugin emits nothing until the frontend
    // calls `trackEvent`, so the consent gate lives at the JS `track()` helper.
    // No key (every local/dev build) → skip registration cleanly, no panic.
    if let Some(key) = APTABASE_KEY {
        builder = builder.plugin(tauri_plugin_aptabase::Builder::new(key).build());
    }

    // Telemetry — crash/error reporting (Sentry). Registered only when the
    // client was successfully built above (DSN present). The plugin injects
    // `@sentry/browser` and routes frontend errors through Rust via `invoke`,
    // so frontend egress rides the Rust SDK — no widening of the JS HTTP
    // capability surface. Runtime crash-consent gating is handled by binding /
    // unbinding the client on the Hub (`telemetry::set_sentry_enabled`).
    if let Some(client) = telemetry::sentry_client() {
        builder = builder.plugin(tauri_plugin_sentry::init(&client));
    }

    // WebDriver plugin for real E2E testing (only when compiled with `--features e2e-testing`)
    #[cfg(feature = "e2e-testing")]
    {
        builder = builder.plugin(tauri_plugin_webdriver::init());
    }

    builder
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
        .invoke_handler(tauri::generate_handler![
            open_devtools,
            set_log_level,
            alpha_check,
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
            delete_path,
            path_exists,
            allow_asset_dir,
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
            agent_install_node_runtime,
            agent_check_updates,
            agent_update,
            acp_agent_check_availability,
            acp_agent_spawn,
            acp_agent_authenticate,
            acp_agent_exists,
            acp_is_agent_alive,
            acp_agent_stop,
            acp_agent_reconnect,
            acp_session_new,
            acp_session_load,
            acp_session_prompt,
            acp_supports_images,
            acp_session_cancel,
            acp_session_set_mode,
            acp_session_set_config_option,
            acp_session_set_model,
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
            copilot_lsp_sign_out,
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
            discover_skills,
            extract_skill_tools,
            read_skill_content,
            execute_skill_script,
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
            start_completion_server,
            stop_completion_server,
            get_completion_server_status,
            check_llama_server_available,
            // Model metadata
            get_model_metadata,
            fetch_hf_metadata,
            parse_gguf_metadata,
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
            // Sandbox violation monitoring
            sandbox_monitor_register_pid,
            sandbox_monitor_unregister_pid,
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
        ])
        .setup(|app| {
            // Log startup at Info before restricting to Warn — this line always appears.
            log::info!(target: "notesage::lifecycle", "Notesage starting up (version {})", app.package_info().version);
            // Default to Warn until user raises it in Settings via set_log_level().
            log::set_max_level(log::LevelFilter::Warn);

            // Kill orphaned agent processes from previous sessions that weren't cleaned up
            // (e.g. app was force-quit or crashed).
            for pattern in &["claude-agent-acp", "codex-acp"] {
                let _ = std::process::Command::new("pkill")
                    .args(["-f", pattern])
                    .output();
            }
            // Kill orphaned llama-server by PID file — NOT pkill, which would kill
            // llama-server instances from other apps (Ollama, LM Studio, etc.) and
            // race with the frontend's auto-start after app updates.
            local_inference::kill_orphaned_servers();
            sandbox::cleanup_legacy_profiles();
            log::debug!(target: "notesage::lifecycle", "Cleaned up orphaned agent processes");

            // Set up system tray
            if let Err(e) = tray::setup_tray(app) {
                log::error!(target: "notesage::tray", "Failed to set up tray: {}", e);
            }

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
