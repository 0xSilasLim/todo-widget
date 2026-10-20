use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{atomic::AtomicBool, Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::{Store, StoreExt};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Todo {
    pub id: String,
    pub text: String,
    pub completed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub always_on_top: bool,
    pub locked: bool,
    pub background_opacity: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            always_on_top: true,
            locked: false,
            background_opacity: 0.88,
        }
    }
}

impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !self.background_opacity.is_finite() || !(0.2..=1.0).contains(&self.background_opacity) {
            return Err("背景不透明度必须介于 20% 和 100%".into());
        }
        Ok(())
    }
}

#[derive(Serialize)]
pub struct WidgetData {
    pub todos: Vec<Todo>,
    pub settings: Settings,
}

pub struct WidgetState {
    pub store: Arc<Store<tauri::Wry>>,
    pub settings: Mutex<Settings>,
    pub positioning: AtomicBool,
}

fn validate_todos(todos: &[Todo]) -> Result<(), String> {
    if todos.len() > 10_000 {
        return Err("待办数量超过本地清单上限".into());
    }
    let mut ids = HashSet::new();
    for todo in todos {
        if todo.id.is_empty()
            || todo.id.len() > 128
            || !ids.insert(&todo.id)
            || todo.text.trim().is_empty()
            || todo.text.chars().count() > 500
        {
            return Err("待办数据无效：内容需为 1–500 字，且标识不能重复".into());
        }
    }
    Ok(())
}

impl WidgetState {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        // Store is only exposed to typed Rust commands; the renderer receives no
        // plugin:store permissions, arbitrary file paths, or filesystem access.
        let store = app
            .store_builder("widget.json")
            .auto_save(Duration::from_millis(300))
            .build()?;
        // StoreBuilder deliberately ignores load errors. Check an existing file
        // explicitly before any geometry event can replace unreadable data.
        if app.path().app_data_dir()?.join("widget.json").exists() {
            store.reload()?;
        }
        let settings: Settings = store
            .get("settings")
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();
        let settings = if settings.validate().is_ok() {
            settings
        } else {
            Settings::default()
        };
        Ok(Self {
            store,
            settings: Mutex::new(settings),
            positioning: AtomicBool::new(false),
        })
    }

    pub fn load(&self) -> Result<WidgetData, String> {
        let todos: Vec<Todo> = match self.store.get("todos") {
            Some(value) => serde_json::from_value(value)
                .map_err(|error| format!("本地任务格式有误：{error}"))?,
            None => Vec::new(),
        };
        validate_todos(&todos)?;
        let settings = self
            .settings
            .lock()
            .map_err(|error| error.to_string())?
            .clone();
        Ok(WidgetData { todos, settings })
    }

    pub fn save_todos(&self, todos: Vec<Todo>) -> Result<(), String> {
        validate_todos(&todos)?;
        self.store.set("schemaVersion", serde_json::json!(1));
        self.store.set(
            "todos",
            serde_json::to_value(todos).map_err(|error| error.to_string())?,
        );
        self.store.save().map_err(|error| error.to_string())
    }

    pub fn save_settings(&self, settings: Settings) -> Result<(), String> {
        settings.validate()?;
        *self.settings.lock().map_err(|error| error.to_string())? = settings.clone();
        self.store.set("schemaVersion", serde_json::json!(1));
        self.store.set(
            "settings",
            serde_json::to_value(settings).map_err(|error| error.to_string())?,
        );
        self.store.save().map_err(|error| error.to_string())
    }

    pub fn ensure_unlocked(&self) -> Result<(), String> {
        if self
            .settings
            .lock()
            .map_err(|error| error.to_string())?
            .locked
        {
            Err("位置已锁定，请先在设置中解锁".into())
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opacity_must_stay_in_supported_range() {
        for opacity in [0.0, 0.19, 1.01, f64::NAN] {
            assert!(Settings {
                background_opacity: opacity,
                ..Settings::default()
            }
            .validate()
            .is_err());
        }
        for opacity in [0.2, 0.88, 1.0] {
            assert!(Settings {
                background_opacity: opacity,
                ..Settings::default()
            }
            .validate()
            .is_ok());
        }
    }

    #[test]
    fn duplicate_ids_and_empty_text_are_rejected() {
        let valid = Todo {
            id: "one".into(),
            text: "test".into(),
            completed: false,
        };
        assert!(validate_todos(std::slice::from_ref(&valid)).is_ok());
        assert!(validate_todos(&[valid.clone(), valid]).is_err());
        assert!(validate_todos(&[Todo {
            id: "two".into(),
            text: "  ".into(),
            completed: false
        }])
        .is_err());
    }
}
