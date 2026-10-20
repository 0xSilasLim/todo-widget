use crate::{
    geometry::{self, Placement, SavedWindow, Screen},
    persistence::WidgetState,
};
use std::sync::atomic::Ordering;
use tauri::{LogicalSize, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

fn screen(monitor: &Monitor) -> Screen {
    let work = monitor.work_area();
    Screen {
        name: monitor.name().cloned(),
        origin_x: monitor.position().x,
        origin_y: monitor.position().y,
        work_x: work.position.x,
        work_y: work.position.y,
        work_width: work.size.width,
        work_height: work.size.height,
        scale: monitor.scale_factor(),
    }
}

fn apply(
    window: &WebviewWindow,
    monitor: &Screen,
    placement: Placement,
    state: &WidgetState,
) -> Result<(), String> {
    state.positioning.store(true, Ordering::SeqCst);
    let result = (|| {
        // A small work area (remote session / unusual scaling) takes precedence
        // over our normal minimum so the whole widget remains reachable.
        window.set_position(PhysicalPosition::new(placement.x, placement.y))?;
        window.set_min_size(Some(LogicalSize::new(
            geometry::MIN_WIDTH.min(monitor.work_width as f64 / monitor.scale),
            geometry::MIN_HEIGHT.min(monitor.work_height as f64 / monitor.scale),
        )))?;
        window.set_size(PhysicalSize::new(placement.width, placement.height))?;
        Ok::<(), tauri::Error>(())
    })();
    state.positioning.store(false, Ordering::SeqCst);
    result.map_err(|error| error.to_string())?;
    capture(window, state);
    Ok(())
}

pub fn initialize(window: &WebviewWindow, state: &WidgetState) -> Result<(), String> {
    let monitors = window
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let screens: Vec<Screen> = monitors.iter().map(screen).collect();
    let primary = window
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| monitors.first().cloned())
        .ok_or("无法读取显示器工作区")?;
    let primary = screen(&primary);
    let saved: Option<SavedWindow> = state
        .store
        .get("window")
        .and_then(|value| serde_json::from_value(value).ok())
        .filter(geometry::valid_saved);
    let (monitor, placement) = if let Some(saved) = saved.as_ref() {
        if let Some(monitor) = geometry::matching_screen(&screens, saved) {
            (monitor.clone(), geometry::restore(monitor, saved))
        } else {
            (
                primary.clone(),
                geometry::anchor(&primary, saved.width, saved.height),
            )
        }
    } else {
        (
            primary.clone(),
            geometry::anchor(&primary, geometry::DEFAULT_WIDTH, geometry::DEFAULT_HEIGHT),
        )
    };
    apply(window, &monitor, placement, state)?;
    let settings = state.settings.lock().map_err(|error| error.to_string())?;
    window
        .set_always_on_top(settings.always_on_top)
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(!settings.locked)
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn capture(window: &WebviewWindow, state: &WidgetState) {
    if state.positioning.load(Ordering::SeqCst) || window.is_minimized().unwrap_or(true) {
        return;
    }
    let (Ok(Some(monitor)), Ok(position), Ok(size)) = (
        window.current_monitor(),
        window.outer_position(),
        window.inner_size(),
    ) else {
        return;
    };
    if size.width == 0 || size.height == 0 {
        return;
    }
    let placement = Placement {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    if let Ok(value) = serde_json::to_value(geometry::remember(&screen(&monitor), &placement)) {
        state.store.set("window", value);
    }
}

pub fn reset(window: &WebviewWindow, state: &WidgetState) -> Result<(), String> {
    let monitor = window
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .ok_or("无法读取主显示器")?;
    let monitor = screen(&monitor);
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let placement = geometry::anchor(
        &monitor,
        size.width as f64 / scale,
        size.height as f64 / scale,
    );
    apply(window, &monitor, placement, state)?;
    state.store.save().map_err(|error| error.to_string())
}

pub fn keep_visible(window: &WebviewWindow, state: &WidgetState) {
    if state.positioning.load(Ordering::SeqCst) {
        return;
    }
    let (Ok(Some(monitor)), Ok(position), Ok(size)) = (
        window.current_monitor(),
        window.outer_position(),
        window.inner_size(),
    ) else {
        return;
    };
    let monitor = screen(&monitor);
    let current = Placement {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let restored = geometry::restore(&monitor, &geometry::remember(&monitor, &current));
    if current != restored {
        if let Err(error) = apply(window, &monitor, restored, state) {
            eprintln!("Could not fit widget to work area: {error}");
        }
    }
}
