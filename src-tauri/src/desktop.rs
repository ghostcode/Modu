use crate::{model::Source, AppState};
use tauri::{Emitter, Manager};

pub fn theme_name(value: &serde_json::Value) -> &'static str {
    if value["followSystemTheme"] == true {
        "system"
    } else if value["theme"] == "paper" {
        "paper"
    } else {
        "night"
    }
}
fn appearance(theme: &str) -> (tauri::Theme, tauri::utils::config::Color) {
    if theme == "paper" {
        (
            tauri::Theme::Light,
            tauri::utils::config::Color(250, 248, 244, 255),
        )
    } else {
        (
            tauri::Theme::Dark,
            tauri::utils::config::Color(36, 39, 44, 255),
        )
    }
}
#[tauri::command]
pub fn set_app_appearance(
    window: tauri::WebviewWindow,
    theme: String,
    follow_system: bool,
) -> Result<(), String> {
    let (theme, color) = appearance(&theme);
    window
        .set_theme((!follow_system).then_some(theme))
        .map_err(|e| e.to_string())?;
    window
        .set_background_color(Some(color))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "macos")]
        {
            let mut fonts = core_text::font_manager::copy_available_font_family_names()
                .iter()
                .map(|name| name.to_string())
                .filter(|name| !name.trim().is_empty())
                .collect::<Vec<_>>();
            fonts.sort();
            fonts.dedup();
            if fonts.is_empty() {
                return Err("暂时无法读取系统字体，仍可输入已安装的字体名称。".to_string());
            }
            Ok(fonts)
        }
        #[cfg(target_os = "windows")]
        {
            Ok(windows_system_fonts())
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err("此平台暂不支持自动查询系统字体，仍可手动输入字体名称。".to_string())
        }
    })
    .await
    .map_err(|_| "字体查询未完成，请重试。".to_string())?
}
#[cfg(target_os = "windows")]
fn windows_system_fonts() -> Vec<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const SCRIPT: &str = concat!(
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;",
        "$k='HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';",
        "(Get-ItemProperty -LiteralPath $k).PSObject.Properties",
        "| Where-Object { $_.Name -notlike 'PS*' }",
        "| ForEach-Object { $_.Name }",
    );
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok();
    let mut fonts = output
        .filter(|result| result.status.success())
        .map(|result| String::from_utf8_lossy(&result.stdout).into_owned())
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| {
            let name = name.trim_end_matches(|c: char| c == ')' || c.is_whitespace());
            match name.rfind(" (") {
                Some(index) => name[..index].trim().to_string(),
                None => name.to_string(),
            }
        })
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    fonts.sort();
    fonts.dedup();
    fonts
}
#[tauri::command]
pub fn record_feed_failure(
    state: tauri::State<AppState>,
    id: String,
    message: String,
) -> Result<Source, String> {
    crate::with_db(&state, |db| db.record_feed_failure(&id, &message))
}
#[tauri::command]
pub fn set_subscription_archived(
    state: tauri::State<AppState>,
    id: String,
    archived: bool,
) -> Result<(), String> {
    crate::with_db(&state, |db| db.set_source_archived(&id, archived))
}
fn menu_labels(locale: &str) -> (&'static str, &'static str) {
    if locale == "en" {
        ("Settings…", "Check for Updates…")
    } else {
        ("设置…", "检查更新…")
    }
}

#[tauri::command]
pub fn set_app_locale(app: tauri::AppHandle, locale: String) -> Result<(), String> {
    let (settings, updates) = menu_labels(&locale);
    if let Some(tauri::menu::MenuItemKind::Submenu(submenu)) =
        app.menu()
            .and_then(|menu| menu.items().ok())
            .and_then(|items| items.into_iter().next())
    {
        for (id, label) in [("app-settings", settings), ("app-updates", updates)] {
            if let Some(tauri::menu::MenuItemKind::MenuItem(item)) = submenu.get(id) {
                item.set_text(label).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

pub fn create_main_window(app: &tauri::App, theme: &str, locale: &str) -> tauri::Result<()> {
    let (native, color) = appearance(theme);
    let mut config = app.config().app.windows[0].clone();
    if theme == "system" {
        config.background_color = None;
    }
    let builder = tauri::WebviewWindowBuilder::from_config(app, &config)?
        .initialization_script(format!(
            "window.__MODU_APPEARANCE__={};",
            serde_json::json!({ "theme": theme, "locale": locale })
        ))
        .theme((theme != "system").then_some(native));
    let window = if theme == "system" {
        builder.build()?
    } else {
        builder.background_color(color).build()?
    };
    restore_window_size(&window);
    let (settings_label, updates_label) = menu_labels(locale);
    let settings = tauri::menu::MenuItem::with_id(
        app,
        "app-settings",
        settings_label,
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let updates =
        tauri::menu::MenuItem::with_id(app, "app-updates", updates_label, true, None::<&str>)?;

    #[cfg(target_os = "macos")]
    {
        let menu = tauri::menu::Menu::default(app.handle())?;
        if let Some(tauri::menu::MenuItemKind::Submenu(submenu)) = menu.items()?.first() {
            submenu.insert(&settings, 1)?;
            submenu.insert(&updates, 2)?;
        }
        app.set_menu(menu)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let submenu = tauri::menu::Submenu::with_items(
            app,
            if locale == "en" { "App" } else { "应用" },
            true,
            &[&settings, &updates],
        )?;
        let menu = tauri::menu::Menu::with_items(app, &[&submenu])?;
        app.set_menu(menu)?;
    }
    Ok(())
}
pub fn handle_menu(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    if app.try_state::<AppState>().is_some_and(|state| {
        state
            .updates
            .installing
            .load(std::sync::atomic::Ordering::SeqCst)
    }) {
        return;
    }
    match event.id().as_ref() {
        "app-settings" => {
            let _ = app.emit("modu://settings", ());
        }
        "app-updates" => {
            let _ = app.emit("modu://updates", ());
        }
        _ => {}
    }
}

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct WindowSize {
    width: f64,
    height: f64,
}
fn fit_size(size: WindowSize, available: (f64, f64)) -> WindowSize {
    let width = if size.width.is_finite() {
        size.width
    } else {
        1400.
    };
    let height = if size.height.is_finite() {
        size.height
    } else {
        940.
    };
    WindowSize {
        width: width.clamp(840., available.0.max(840.)),
        height: height.clamp(600., available.1.max(600.)),
    }
}
pub fn remember_window_size(window: &tauri::Window) {
    if window.is_maximized().unwrap_or(true) || window.is_fullscreen().unwrap_or(true) {
        return;
    }
    if let (Ok(size), Ok(scale), Some(state)) = (
        window.inner_size(),
        window.scale_factor(),
        window.try_state::<AppState>(),
    ) {
        let size = size.to_logical::<f64>(scale);
        if size.width >= 840. && size.height >= 600. {
            if let Ok(mut last) = state.window_size.lock() {
                *last = Some(WindowSize {
                    width: size.width,
                    height: size.height,
                });
            }
        }
    }
}
pub fn persist_window_size(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(last) = state.window_size.lock() else {
        return;
    };
    let Some(size) = *last else { return };
    if let Ok(bytes) = serde_json::to_vec(&size) {
        let target = state.data_dir.join("window-size.json");
        let temp = state.data_dir.join("window-size.tmp");
        if std::fs::write(&temp, bytes).is_ok() {
            let _ = std::fs::rename(temp, target);
        }
    }
}
fn restore_window_size(window: &tauri::WebviewWindow) {
    let state = window.state::<AppState>();
    if let Some(size) = std::fs::read(state.data_dir.join("window-size.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<WindowSize>(&bytes).ok())
    {
        if window.is_maximized().unwrap_or(false) {
            if let Ok(mut last) = state.window_size.lock() {
                *last = Some(size);
            }
            return;
        }
        if let Some(monitor) = window
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| window.primary_monitor().ok().flatten())
        {
            let logical = monitor.size().to_logical::<f64>(monitor.scale_factor());
            let size = fit_size(size, (logical.width - 24., logical.height - 64.));
            let _ = window.set_size(tauri::LogicalSize::new(size.width, size.height));
            if let (Ok(position), Ok(outer)) = (window.outer_position(), window.outer_size()) {
                let origin = monitor.position();
                let max_x = (origin.x as i64 + monitor.size().width as i64 - outer.width as i64)
                    .max(origin.x as i64);
                let max_y = (origin.y as i64 + monitor.size().height as i64 - outer.height as i64)
                    .max(origin.y as i64);
                let _ = window.set_position(tauri::PhysicalPosition::new(
                    (position.x as i64).clamp(origin.x as i64, max_x) as i32,
                    (position.y as i64).clamp(origin.y as i64, max_y) as i32,
                ));
            }
            if let Ok(mut last) = state.window_size.lock() {
                *last = Some(size);
            }
        }
    }
    remember_window_size(&window.as_ref().window());
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logical_size_is_bounded_without_using_previous_screen_scale() {
        let saved = WindowSize {
            width: 1200.,
            height: 850.,
        };
        let same = fit_size(saved, (1500., 1000.));
        assert_eq!((same.width, same.height), (1200., 850.));
        let small = fit_size(saved, (1000., 700.));
        assert_eq!((small.width, small.height), (1000., 700.));
        let bad = fit_size(
            WindowSize {
                width: f64::NAN,
                height: 0.,
            },
            (1200., 800.),
        );
        assert_eq!((bad.width, bad.height), (1200., 600.));
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn core_text_discovers_real_installed_font_families() {
        let fonts = core_text::font_manager::copy_available_font_family_names();
        assert!(!fonts.is_empty());
        assert!(fonts
            .iter()
            .any(|name| name.to_string().contains("PingFang")));
    }
}
