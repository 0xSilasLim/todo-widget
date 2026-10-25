use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{atomic::AtomicBool, Arc, Mutex},
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::{Store, StoreExt};

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    P0,
    P1,
    #[default]
    P2,
    P3,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Todo {
    pub id: String,
    pub text: String,
    pub completed: bool,
    #[serde(default)]
    pub priority: Priority,
    #[serde(default, rename = "createdAt", skip_serializing_if = "Option::is_none")]
    pub created_at: Option<u64>,
    #[serde(default, rename = "dueAt", skip_serializing_if = "Option::is_none")]
    pub due_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub always_on_top: bool,
    pub locked: bool,
    pub background_opacity: f64,
    pub deadline_notifications: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            always_on_top: true,
            locked: false,
            background_opacity: 0.88,
            deadline_notifications: false,
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
    // Serialize task/settings changes with the native reminder check.
    pub write_lock: Mutex<()>,
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
            || todo
                .created_at
                .is_some_and(|value| value > 8_640_000_000_000_000)
            || todo.due_at.is_some_and(|value| value > 253_402_300_799_999)
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
            write_lock: Mutex::new(()),
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
        let _guard = self.write_lock.lock().map_err(|error| error.to_string())?;
        let previous = self.store.get("todos");
        let previous_reminders = self.store.get("deadlineReminders");
        let mut reminders = crate::reminders::load_records(&self.store)?;
        crate::reminders::retain_current(&mut reminders, &todos);
        self.store.set(
            "deadlineReminders",
            serde_json::to_value(reminders).map_err(|error| error.to_string())?,
        );
        self.store.set("schemaVersion", serde_json::json!(1));
        self.store.set(
            "todos",
            serde_json::to_value(todos).map_err(|error| error.to_string())?,
        );
        if let Err(error) = self.store.save() {
            restore_value(&self.store, "todos", previous);
            restore_value(&self.store, "deadlineReminders", previous_reminders);
            return Err(error.to_string());
        }
        Ok(())
    }

    pub fn save_settings(&self, settings: Settings) -> Result<(), String> {
        settings.validate()?;
        let _guard = self.write_lock.lock().map_err(|error| error.to_string())?;
        let previous = self.store.get("settings");
        self.store.set("schemaVersion", serde_json::json!(1));
        self.store.set(
            "settings",
            serde_json::to_value(&settings).map_err(|error| error.to_string())?,
        );
        if let Err(error) = self.store.save() {
            restore_value(&self.store, "settings", previous);
            return Err(error.to_string());
        }
        *self.settings.lock().map_err(|error| error.to_string())? = settings;
        Ok(())
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

pub(crate) fn restore_value(
    store: &Store<tauri::Wry>,
    key: &str,
    value: Option<serde_json::Value>,
) {
    match value {
        Some(value) => {
            store.set(key, value);
        }
        None => {
            store.delete(key);
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
            priority: Priority::P2,
            created_at: None,
            due_at: None,
        };
        assert!(validate_todos(std::slice::from_ref(&valid)).is_ok());
        assert!(validate_todos(&[valid.clone(), valid]).is_err());
        assert!(validate_todos(&[Todo {
            id: "two".into(),
            text: "  ".into(),
            completed: false,
            priority: Priority::P2,
            created_at: None,
            due_at: None,
        }])
        .is_err());
    }

    #[test]
    fn legacy_todos_default_to_p2_without_changing_existing_fields() {
        let todo: Todo = serde_json::from_value(serde_json::json!({
            "id": "legacy", "text": "原有待办", "completed": true
        }))
        .unwrap();
        assert_eq!(todo.priority, Priority::P2);
        assert_eq!(todo.created_at, None);
        assert_eq!(
            serde_json::to_value(todo).unwrap(),
            serde_json::json!({
                "id": "legacy", "text": "原有待办", "completed": true, "priority": "p2"
            })
        );
    }

    #[test]
    fn all_priorities_round_trip_and_invalid_values_are_rejected() {
        for value in ["p0", "p1", "p2", "p3"] {
            let json = serde_json::json!({
                "id": "one", "text": "任务", "completed": false, "priority": value
            });
            let todo: Todo = serde_json::from_value(json.clone()).unwrap();
            assert!(validate_todos(std::slice::from_ref(&todo)).is_ok());
            assert_eq!(serde_json::to_value(todo).unwrap(), json);
        }
        for value in [
            serde_json::json!("p4"),
            serde_json::json!(0),
            serde_json::Value::Null,
        ] {
            assert!(serde_json::from_value::<Todo>(serde_json::json!({
                "id": "one", "text": "任务", "completed": false, "priority": value
            }))
            .is_err());
        }
    }

    #[test]
    fn creation_time_round_trips_and_invalid_timestamps_are_rejected() {
        for timestamp in [0, 1_792_924_800_000_u64, 8_640_000_000_000_000] {
            let json = serde_json::json!({
                "id": "one", "text": "任务", "completed": false,
                "priority": "p0", "createdAt": timestamp
            });
            let todo: Todo = serde_json::from_value(json.clone()).unwrap();
            assert!(validate_todos(std::slice::from_ref(&todo)).is_ok());
            assert_eq!(serde_json::to_value(todo).unwrap(), json);
        }
        for value in [
            serde_json::json!("today"),
            serde_json::json!(-1),
            serde_json::json!(1.5),
        ] {
            assert!(serde_json::from_value::<Todo>(serde_json::json!({
                "id": "one", "text": "任务", "completed": false, "createdAt": value
            }))
            .is_err());
        }
        let todo: Todo = serde_json::from_value(serde_json::json!({
            "id": "one", "text": "任务", "completed": true,
            "createdAt": 8_640_000_000_000_001_u64
        }))
        .unwrap();
        assert!(validate_todos(&[todo]).is_err());
    }

    #[test]
    fn deadlines_round_trip_and_old_tasks_and_settings_keep_safe_defaults() {
        let todo: Todo = serde_json::from_value(serde_json::json!({
            "id":"one", "text":"任务", "completed":false, "dueAt":1_792_924_800_000_u64
        }))
        .unwrap();
        assert_eq!(todo.due_at, Some(1_792_924_800_000));
        assert!(validate_todos(std::slice::from_ref(&todo)).is_ok());
        let restored: Todo = serde_json::from_value(serde_json::to_value(todo).unwrap()).unwrap();
        assert_eq!(restored.due_at, Some(1_792_924_800_000));
        let old: Todo = serde_json::from_value(
            serde_json::json!({"id":"old","text":"旧任务","completed":true}),
        )
        .unwrap();
        assert_eq!(old.due_at, None);
        let settings: Settings =
            serde_json::from_value(serde_json::json!({"locked":true})).unwrap();
        assert!(!settings.deadline_notifications);
        assert!(settings.locked);
        for value in [
            serde_json::json!(-1),
            serde_json::json!(1.5),
            serde_json::json!("tomorrow"),
        ] {
            assert!(serde_json::from_value::<Todo>(
                serde_json::json!({"id":"one","text":"任务","completed":false,"dueAt":value})
            )
            .is_err());
        }
        let invalid: Todo = serde_json::from_value(serde_json::json!({"id":"one","text":"任务","completed":false,"dueAt":253_402_300_800_000_u64})).unwrap();
        assert!(validate_todos(&[invalid]).is_err());
    }
}
