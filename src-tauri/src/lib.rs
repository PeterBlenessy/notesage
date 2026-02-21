mod commands;
mod export;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(WatcherState::new())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            list_directory,
            list_files_shallow,
            create_file,
            create_directory,
            rename_path,
            delete_path,
            path_exists,
            open_folder_dialog,
            ai_generate_text,
            ai_chat,
            ai_chat_stream,
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
            save_binary_file,
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
            acp_agent_check_availability,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
