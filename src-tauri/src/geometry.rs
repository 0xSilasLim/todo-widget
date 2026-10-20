use serde::{Deserialize, Serialize};

pub const DEFAULT_WIDTH: f64 = 320.0;
pub const DEFAULT_HEIGHT: f64 = 420.0;
pub const MIN_WIDTH: f64 = 280.0;
pub const MIN_HEIGHT: f64 = 320.0;
pub const MARGIN: f64 = 16.0;

#[derive(Clone, Debug)]
pub struct Screen {
    pub name: Option<String>,
    pub origin_x: i32,
    pub origin_y: i32,
    pub work_x: i32,
    pub work_y: i32,
    pub work_width: u32,
    pub work_height: u32,
    pub scale: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedWindow {
    pub monitor_name: Option<String>,
    pub monitor_x: i32,
    pub monitor_y: i32,
    // Offsets from the work area, in the saved monitor's logical pixels.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn valid_saved(saved: &SavedWindow) -> bool {
    [saved.x, saved.y, saved.width, saved.height]
        .iter()
        .all(|value| value.is_finite())
        && saved.width > 0.0
        && saved.height > 0.0
}

pub fn matching_screen<'a>(screens: &'a [Screen], saved: &SavedWindow) -> Option<&'a Screen> {
    screens
        .iter()
        .find(|screen| {
            screen.name == saved.monitor_name
                && screen.origin_x == saved.monitor_x
                && screen.origin_y == saved.monitor_y
        })
        .or_else(|| {
            // A screen may have moved in Windows Display Settings. Only use its name
            // when unique; generic duplicate monitor names must not pick at random.
            let mut matches = screens
                .iter()
                .filter(|screen| saved.monitor_name.is_some() && screen.name == saved.monitor_name);
            let first = matches.next();
            if matches.next().is_none() {
                first
            } else {
                None
            }
        })
}

fn fitted_size(screen: &Screen, width: f64, height: f64) -> (u32, u32) {
    let area_width = screen.work_width as f64 / screen.scale;
    let area_height = screen.work_height as f64 / screen.scale;
    let width = width.clamp(MIN_WIDTH.min(area_width), area_width);
    let height = height.clamp(MIN_HEIGHT.min(area_height), area_height);
    (
        (width * screen.scale).round() as u32,
        (height * screen.scale).round() as u32,
    )
}

pub fn anchor(screen: &Screen, width: f64, height: f64) -> Placement {
    let (width, height) = fitted_size(screen, width, height);
    let right = screen.work_x + screen.work_width as i32;
    let bottom = screen.work_y + screen.work_height as i32;
    let margin = (MARGIN * screen.scale).round() as i32;
    Placement {
        x: (right - width as i32 - margin).max(screen.work_x),
        y: (screen.work_y + margin)
            .min(bottom - height as i32)
            .max(screen.work_y),
        width,
        height,
    }
}

pub fn restore(screen: &Screen, saved: &SavedWindow) -> Placement {
    let (width, height) = fitted_size(screen, saved.width, saved.height);
    Placement {
        x: (screen.work_x + (saved.x * screen.scale).round() as i32).clamp(
            screen.work_x,
            screen.work_x + screen.work_width as i32 - width as i32,
        ),
        y: (screen.work_y + (saved.y * screen.scale).round() as i32).clamp(
            screen.work_y,
            screen.work_y + screen.work_height as i32 - height as i32,
        ),
        width,
        height,
    }
}

pub fn remember(screen: &Screen, placement: &Placement) -> SavedWindow {
    SavedWindow {
        monitor_name: screen.name.clone(),
        monitor_x: screen.origin_x,
        monitor_y: screen.origin_y,
        x: (placement.x - screen.work_x) as f64 / screen.scale,
        y: (placement.y - screen.work_y) as f64 / screen.scale,
        width: placement.width as f64 / screen.scale,
        height: placement.height as f64 / screen.scale,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn screen(x: i32, y: i32, width: u32, height: u32, scale: f64) -> Screen {
        Screen {
            name: Some(format!("{x}:{y}")),
            origin_x: x,
            origin_y: y,
            work_x: x,
            work_y: y,
            work_width: width,
            work_height: height,
            scale,
        }
    }

    #[test]
    fn primary_at_100_percent_excludes_bottom_taskbar() {
        assert_eq!(
            anchor(&screen(0, 0, 1920, 1032, 1.0), 320.0, 420.0),
            Placement {
                x: 1584,
                y: 16,
                width: 320,
                height: 420
            }
        );
    }

    #[test]
    fn primary_at_150_percent_uses_physical_work_area() {
        assert_eq!(
            anchor(&screen(0, 0, 2560, 1368, 1.5), 320.0, 420.0),
            Placement {
                x: 2056,
                y: 24,
                width: 480,
                height: 630
            }
        );
    }

    #[test]
    fn negative_origin_and_top_left_taskbar() {
        let mut monitor = screen(-2560, -200, 2560, 1440, 1.25);
        monitor.work_x += 60;
        monitor.work_y += 50;
        monitor.work_width -= 60;
        monitor.work_height -= 50;
        assert_eq!(
            anchor(&monitor, 320.0, 420.0),
            Placement {
                x: -420,
                y: -130,
                width: 400,
                height: 525
            }
        );
    }

    #[test]
    fn logical_geometry_round_trips() {
        let monitor = screen(-1920, 200, 1920, 1000, 1.25);
        let placement = Placement {
            x: -1600,
            y: 250,
            width: 450,
            height: 600,
        };
        assert_eq!(
            restore(&monitor, &remember(&monitor, &placement)),
            placement
        );
    }

    #[test]
    fn changing_dpi_preserves_logical_size_and_offset() {
        let original = screen(0, 0, 1920, 1032, 1.0);
        let saved = remember(
            &original,
            &Placement {
                x: 100,
                y: 80,
                width: 320,
                height: 420,
            },
        );
        let scaled = screen(0, 0, 3840, 2080, 2.0);
        assert_eq!(
            restore(&scaled, &saved),
            Placement {
                x: 200,
                y: 160,
                width: 640,
                height: 840
            }
        );
    }

    #[test]
    fn offscreen_geometry_is_clamped_to_work_area() {
        let monitor = screen(0, 0, 1920, 1032, 1.0);
        let mut saved = remember(&monitor, &anchor(&monitor, 320.0, 420.0));
        saved.x = 10000.0;
        saved.y = -500.0;
        saved.width = 5000.0;
        assert_eq!(
            restore(&monitor, &saved),
            Placement {
                x: 0,
                y: 0,
                width: 1920,
                height: 420
            }
        );
    }

    #[test]
    fn tiny_work_area_stays_reachable() {
        assert_eq!(
            anchor(&screen(0, 0, 200, 200, 1.0), 320.0, 420.0),
            Placement {
                x: 0,
                y: 0,
                width: 200,
                height: 200
            }
        );
    }

    #[test]
    fn unplugged_monitor_falls_back_instead_of_using_another_screen() {
        let gone = screen(-1920, 0, 1920, 1032, 1.0);
        let saved = remember(&gone, &anchor(&gone, 320.0, 420.0));
        assert!(matching_screen(&[screen(0, 0, 2560, 1400, 1.5)], &saved).is_none());
    }

    #[test]
    fn duplicate_monitor_names_require_matching_origin() {
        let mut left = screen(-1920, 0, 1920, 1032, 1.0);
        let mut right = screen(0, 0, 1920, 1032, 1.0);
        left.name = Some("Generic".into());
        right.name = left.name.clone();
        let saved = remember(&left, &anchor(&left, 320.0, 420.0));
        let screens = [right, left];
        assert_eq!(matching_screen(&screens, &saved).unwrap().origin_x, -1920);
    }

    #[test]
    fn invalid_persisted_geometry_is_rejected() {
        let monitor = screen(0, 0, 1920, 1032, 1.0);
        let mut saved = remember(&monitor, &anchor(&monitor, 320.0, 420.0));
        saved.width = -1.0;
        assert!(!valid_saved(&saved));
    }
}
