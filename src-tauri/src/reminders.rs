use crate::persistence::{restore_value, Todo, WidgetState};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::Store;

const HOUR: u64 = 3_600_000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReminderRecord {
    due_at: u64,
    stage: u8,
}
pub(crate) type Records = HashMap<String, ReminderRecord>;

pub(crate) fn load_records(store: &Store<tauri::Wry>) -> Result<Records, String> {
    match store.get("deadlineReminders") {
        Some(value) => {
            serde_json::from_value(value).map_err(|error| format!("提醒记录格式有误：{error}"))
        }
        None => Ok(Records::new()),
    }
}

pub(crate) fn retain_current(records: &mut Records, todos: &[Todo]) {
    records.retain(|id, record| {
        todos
            .iter()
            .any(|todo| &todo.id == id && todo.due_at == Some(record.due_at))
    });
}

fn pending_stage(todo: &Todo, now: u64, records: &Records) -> Option<ReminderRecord> {
    if todo.completed {
        return None;
    }
    let due_at = todo.due_at?;
    let stage = if now >= due_at {
        2
    } else if due_at - now <= HOUR {
        1
    } else {
        return None;
    };
    if records
        .get(&todo.id)
        .is_some_and(|record| record.due_at == due_at && record.stage >= stage)
    {
        return None;
    }
    Some(ReminderRecord { due_at, stage })
}

fn check(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<WidgetState>();
    let _guard = state.write_lock.lock().map_err(|error| error.to_string())?;
    let data = state.load()?;
    if !data.settings.deadline_notifications {
        return Ok(());
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as u64;
    let mut records = load_records(&state.store)?;
    for todo in data.todos {
        let Some(record) = pending_stage(&todo, now, &records) else {
            continue;
        };
        let title = if record.stage == 1 {
            "DDL 提醒：任务即将截止"
        } else {
            "DDL 提醒：任务已到截止时间"
        };
        let body = if record.stage == 1 {
            format!("{}\n距离截止不足 1 小时，请尽快完成。", todo.text)
        } else {
            format!("{}\n已到截止时间，请尽快处理。", todo.text)
        };
        // Persist before submitting to the OS: restarting must not repeat a toast.
        // This records submission, not whether Windows displayed a banner.
        let previous = state.store.get("deadlineReminders");
        let previous_record = records.insert(todo.id.clone(), record);
        state.store.set(
            "deadlineReminders",
            serde_json::to_value(&records).map_err(|error| error.to_string())?,
        );
        if let Err(error) = state.store.save() {
            restore_value(&state.store, "deadlineReminders", previous);
            return Err(error.to_string());
        }
        if let Err(error) = app.notification().builder().title(title).body(body).show() {
            match previous_record {
                Some(previous_record) => {
                    records.insert(todo.id, previous_record);
                }
                None => {
                    records.remove(&todo.id);
                }
            }
            state.store.set(
                "deadlineReminders",
                serde_json::to_value(&records).map_err(|error| error.to_string())?,
            );
            state.store.save().map_err(|error| error.to_string())?;
            return Err(error.to_string());
        }
    }
    Ok(())
}

pub(crate) fn start(app: AppHandle) -> std::io::Result<()> {
    std::thread::Builder::new()
        .name("deadline-reminders".into())
        .spawn(move || {
            let mut last_error = String::new();
            loop {
                let current_error = check(&app).err().unwrap_or_default();
                if current_error != last_error {
                    if !current_error.is_empty() {
                        eprintln!("Deadline reminder check failed: {current_error}");
                    }
                    let _ = app.emit("deadline-reminder-error", &current_error);
                    last_error = current_error;
                }
                // Wall-clock comparisons also catch deadlines passed during sleep.
                std::thread::sleep(Duration::from_secs(15));
            }
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn todo(due_at: Option<u64>, completed: bool) -> Todo {
        serde_json::from_value(
            serde_json::json!({"id":"one","text":"任务","completed":completed,"dueAt":due_at}),
        )
        .unwrap()
    }

    #[test]
    fn only_unfinished_tasks_with_deadlines_in_the_reminder_window_are_due() {
        let records = Records::new();
        assert_eq!(pending_stage(&todo(None, false), HOUR, &records), None);
        assert_eq!(pending_stage(&todo(Some(HOUR), true), HOUR, &records), None);
        assert_eq!(
            pending_stage(&todo(Some(HOUR + 1), false), 0, &records),
            None
        );
        assert_eq!(
            pending_stage(&todo(Some(HOUR), false), 0, &records)
                .unwrap()
                .stage,
            1
        );
        assert_eq!(
            pending_stage(&todo(Some(HOUR), false), HOUR - 1, &records)
                .unwrap()
                .stage,
            1
        );
        assert_eq!(
            pending_stage(&todo(Some(HOUR), false), HOUR, &records)
                .unwrap()
                .stage,
            2
        );
    }

    #[test]
    fn persisted_stages_prevent_duplicates_across_restart_restore_and_clock_changes() {
        let task = todo(Some(HOUR), false);
        let mut records = Records::new();
        records.insert("one".into(), pending_stage(&task, 0, &records).unwrap());
        let mut restored: Records =
            serde_json::from_str(&serde_json::to_string(&records).unwrap()).unwrap();
        assert_eq!(pending_stage(&task, 1, &restored), None);
        restored.insert("one".into(), pending_stage(&task, HOUR, &restored).unwrap());
        assert_eq!(pending_stage(&task, HOUR + 1, &restored), None);
        assert_eq!(pending_stage(&task, 0, &restored), None);
        assert_eq!(
            pending_stage(&todo(Some(HOUR), true), HOUR, &restored),
            None
        );
    }

    #[test]
    fn a_missed_deadline_catches_up_with_only_the_current_stage() {
        let task = todo(Some(HOUR), false);
        let record = pending_stage(&task, HOUR * 3, &Records::new()).unwrap();
        assert_eq!(record.stage, 2);
        let records = HashMap::from([("one".into(), record)]);
        assert_eq!(pending_stage(&task, HOUR * 4, &records), None);
    }

    #[test]
    fn changing_clearing_or_deleting_deadlines_removes_only_the_matching_record() {
        let record = ReminderRecord {
            due_at: HOUR,
            stage: 1,
        };
        for tasks in [
            vec![todo(Some(HOUR * 2), false)],
            vec![todo(None, false)],
            vec![],
        ] {
            let mut records = HashMap::from([("one".into(), record.clone())]);
            retain_current(&mut records, &tasks);
            assert!(records.is_empty());
        }
        let mut records = HashMap::from([("one".into(), record)]);
        retain_current(&mut records, &[todo(Some(HOUR), true)]);
        assert_eq!(records.len(), 1);
        assert!(pending_stage(&todo(Some(HOUR * 2), false), HOUR, &records).is_some());
    }
}
