mod commands;
mod export;
mod index;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init());

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
        .manage(AgentManagerState::new())
        .manage(NetworkProxyState::new())
        .manage(SandboxMonitorState::new())
        .manage(IndexState::new())
        .invoke_handler(tauri::generate_handler![
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
            delete_path,
            path_exists,
            open_folder_dialog,
            run_in_terminal,
            ai_generate_text,
            ai_chat,
            ai_chat_stream,
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
            save_binary_file,
            import_pptx_template,
            list_pptx_templates,
            delete_pptx_template,
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
            // SQLite document index
            index::index_init,
            index::index_file,
            index::index_rebuild,
            index::index_tags,
            index::index_tag_occurrences,
            index::index_mentions,
            index::index_mention_occurrences,
            index::index_search_research,
            index::index_tasks,
            index::index_toggle_task,
            index::index_goals,
            index::index_search_content,
            index::index_stats,
            discover_skills,
            extract_skill_tools,
            read_skill_content,
            execute_skill_script,
            read_agent_instructions,
            extract_bundled_skills,
            discover_agents,
            read_agent_content,
            extract_bundled_agents,
            mcp_start_server,
            mcp_stop_server,
            mcp_restart_server,
            mcp_list_tools,
            mcp_call_tool,
            mcp_get_server_status,
            mcp_discover_configs,
            mcp_import_configs,
            mcp_save_config,
            mcp_check_import_sources,
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
            stop_recording,
            transcribe,
            start_dictation,
            stop_dictation,
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
            check_llama_server_available,
            // Model metadata
            get_model_metadata,
            fetch_hf_metadata,
            parse_gguf_metadata,
            get_runtime_model_metadata,
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
