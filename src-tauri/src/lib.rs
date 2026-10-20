#[cfg(not(target_os = "windows"))]
compile_error!("Todo Widget only supports Windows 11.");

mod geometry;
mod persistence;
mod window;

use persistence::{Settings, Todo, WidgetData, WidgetState};
use tauri::{Manager, State, WebviewWindow};

#[tauri::command]
fn load_widget(state: State<'_, WidgetState>) -> Result<WidgetData, String> {
    state.load()
}

#[tauri::command]
fn reveal_widget(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
fn save_todos(todos: Vec<Todo>, state: State<'_, WidgetState>) -> Result<(), String> {
    state.save_todos(todos)
}

#[tauri::command]
fn update_settings(
    settings: Settings,
    window: WebviewWindow,
    state: State<'_, WidgetState>,
) -> Result<(), String> {
    settings.validate()?;
    window
        .set_always_on_top(settings.always_on_top)
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(!settings.locked)
        .map_err(|error| error.to_string())?;
    state.save_settings(settings)
}

#[tauri::command]
fn reset_position(window: WebviewWindow, state: State<'_, WidgetState>) -> Result<(), String> {
    state.ensure_unlocked()?;
    window::reset(&window, &state)
}

#[tauri::command]
fn start_drag(window: WebviewWindow, state: State<'_, WidgetState>) -> Result<(), String> {
    state.ensure_unlocked()?;
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn start_resize(
    direction: &str,
    window: tauri::Window,
    state: State<'_, WidgetState>,
) -> Result<(), String> {
    state.ensure_unlocked()?;
    let direction = serde_json::from_value(serde_json::Value::String(direction.into()))
        .map_err(|_| "无效的窗口调整方向".to_string())?;
    window
        .start_resize_dragging(direction)
        .map_err(|error| error.to_string())
}

pub fn run() {
    let context = tauri::generate_context!();
    // Native acceptance runs use an isolated profile. This override is compiled
    // out of release builds and does not expose any additional renderer APIs.
    #[cfg(debug_assertions)]
    let context = {
        let mut context = context;
        if let Some(path) = std::env::var_os("TODO_WIDGET_TEST_DATA_DIR") {
            context.config_mut().identifier = "com.local.todowidget.acceptance".into();
            context.config_mut().app.app_directories_override = Some(
                tauri::utils::config::AppDirectoriesOverride::Root(path.into()),
            );
        }
        context
    };
    tauri::Builder::default()
        // Register first so repeated launches exit before loading the Store.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            if windows_version::OsVersion::current().build < 22000 {
                return Err("Todo Widget 仅支持 Windows 11（Build 22000 及以上）".into());
            }
            let state = WidgetState::new(app.handle())?;
            let window = app.get_webview_window("main").ok_or("找不到主窗口")?;
            window::initialize(&window, &state)?;
            app.manage(state);
            Ok(())
        })
        .on_window_event(|window, event| {
            let Some(state) = window.app_handle().try_state::<WidgetState>() else {
                return;
            };
            match event {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    if let Some(webview) = window.app_handle().get_webview_window("main") {
                        window::capture(&webview, &state);
                    }
                }
                tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    if let Some(webview) = window.app_handle().get_webview_window("main") {
                        window::keep_visible(&webview, &state);
                    }
                }
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                    if let Err(error) = state.store.save() {
                        eprintln!("Could not flush widget store: {error}");
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_widget,
            reveal_widget,
            save_todos,
            update_settings,
            reset_position,
            start_drag,
            start_resize,
        ])
        .run(context)
        .expect("failed to run Todo Widget");
}
