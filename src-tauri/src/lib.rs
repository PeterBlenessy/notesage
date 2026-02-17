mod commands;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            list_directory,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
