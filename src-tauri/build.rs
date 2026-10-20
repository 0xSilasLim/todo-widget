fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&[
        "load_widget",
        "reveal_widget",
        "save_todos",
        "update_settings",
        "reset_position",
        "start_drag",
        "start_resize",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("failed to build Tauri application");
}
