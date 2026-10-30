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
pub(crate) type ScheduledRecords = HashMap<String, u64>;

pub(crate) fn load_scheduled(store: &Store<tauri::Wry>) -> Result<ScheduledRecords, String> {
    match store.get("taskReminders") {
        Some(value) => {
            serde_json::from_value(value).map_err(|error| format!("任务提醒记录格式有误：{error}"))
        }
        None => Ok(ScheduledRecords::new()),
    }
}

pub(crate) fn retain_scheduled(records: &mut ScheduledRecords, todos: &[Todo]) {
    records.retain(|id, timestamp| {
        todos
            .iter()
            .any(|todo| &todo.id == id && todo.remind_at == Some(*timestamp))
    });
}

fn pending_reminder(todo: &Todo, now: u64, records: &ScheduledRecords) -> Option<u64> {
    let timestamp = todo.remind_at?;
    (!todo.completed && now >= timestamp && records.get(&todo.id) != Some(&timestamp))
        .then_some(timestamp)
}

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
    if todo.completed || todo.remind_at.is_some() {
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

fn submit<T: Clone + Serialize>(
    app: &AppHandle,
    state: &WidgetState,
    key: &str,
    records: &mut HashMap<String, T>,
    id: &str,
    record: T,
    message: (&str, String),
) -> Result<(), String> {
    // Persist submission before notifying Windows, so restarts do not repeat it.
    let previous = state.store.get(key);
    let previous_record = records.insert(id.into(), record);
    state.store.set(
        key,
        serde_json::to_value(&records).map_err(|error| error.to_string())?,
    );
    if let Err(error) = state.store.save() {
        restore_value(&state.store, key, previous);
        return Err(error.to_string());
    }
    if let Err(error) = app
        .notification()
        .builder()
        .title(message.0)
        .body(message.1)
        // Windows' short message chime plays once, without looping.
        .sound("IM")
        .show()
    {
        match previous_record {
            Some(record) => {
                records.insert(id.into(), record);
            }
            None => {
                records.remove(id);
            }
        }
        state.store.set(
            key,
            serde_json::to_value(&records).map_err(|error| error.to_string())?,
        );
        state.store.save().map_err(|error| error.to_string())?;
        return Err(error.to_string());
    }
    Ok(())
}

fn check(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<WidgetState>();
    let _guard = state.write_lock.lock().map_err(|error| error.to_string())?;
    let data = state.load()?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as u64;
    let mut records = load_records(&state.store)?;
    let mut scheduled = load_scheduled(&state.store)?;
    for todo in data.todos {
        if let Some(timestamp) = pending_reminder(&todo, now, &scheduled) {
            submit(
                app,
                &state,
                "taskReminders",
                &mut scheduled,
                &todo.id,
                timestamp,
                ("任务提醒", format!("{}\n已到你设置的提醒时间。", todo.text)),
            )?;
        }
        if !data.settings.deadline_notifications {
            continue;
        }
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
        submit(
            app,
            &state,
            "deadlineReminders",
            &mut records,
            &todo.id,
            record,
            (title, body),
        )?;
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

    #[test]
    fn a_custom_time_is_independent_of_ddl_and_suppresses_automatic_ddl_alerts() {
        let mut task = todo(Some(HOUR), false);
        task.remind_at = Some(HOUR / 2);
        assert_eq!(
            pending_reminder(&task, HOUR / 2 - 1, &ScheduledRecords::new()),
            None
        );
        assert_eq!(
            pending_reminder(&task, HOUR / 2, &ScheduledRecords::new()),
            Some(HOUR / 2)
        );
        assert_eq!(pending_stage(&task, HOUR * 2, &Records::new()), None);
        task.due_at = None;
        assert_eq!(
            pending_reminder(&task, HOUR, &ScheduledRecords::new()),
            Some(HOUR / 2)
        );
        task.completed = true;
        assert_eq!(
            pending_reminder(&task, HOUR, &ScheduledRecords::new()),
            None
        );
    }

    #[test]
    fn custom_submission_survives_restart_and_task_restore_without_repeating() {
        let mut task = todo(None, false);
        task.remind_at = Some(HOUR);
        let records = HashMap::from([("one".into(), HOUR)]);
        let mut restored: ScheduledRecords =
            serde_json::from_str(&serde_json::to_string(&records).unwrap()).unwrap();
        for now in [0, HOUR, HOUR * 3] {
            assert_eq!(pending_reminder(&task, now, &restored), None);
        }
        task.completed = true;
        retain_scheduled(&mut restored, &[task.clone()]);
        assert_eq!(restored, records);
        task.completed = false;
        assert_eq!(pending_reminder(&task, HOUR * 2, &restored), None);
        task.remind_at = Some(HOUR * 2);
        retain_scheduled(&mut restored, &[task.clone()]);
        assert!(restored.is_empty());
        assert_eq!(pending_reminder(&task, HOUR * 3, &restored), Some(HOUR * 2));
        for tasks in [vec![todo(None, false)], vec![]] {
            let mut current = records.clone();
            retain_scheduled(&mut current, &tasks);
            assert!(current.is_empty());
        }
    }
}
