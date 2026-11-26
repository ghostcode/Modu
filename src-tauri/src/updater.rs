use crate::AppState;
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{ipc::Channel, AppHandle};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::watch;

pub const RELEASES_URL: &str = "https://github.com/Yunz93/Modu/releases";
#[cfg(target_os = "windows")]
fn platform_update_check() -> Result<(), String> {
    Err("Windows 版本暂不支持应用内更新，请从发布页面下载安装包。".into())
}
#[cfg(not(target_os = "windows"))]
fn platform_update_check() -> Result<(), String> {
    Ok(())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub id: String,
    pub version: String,
    pub current_version: String,
    pub notes: String,
    pub date: Option<String>,
}
struct Candidate {
    info: UpdateInfo,
    update: Update,
    bytes: Option<Vec<u8>>,
}
pub struct Updates {
    candidate: Mutex<Option<Candidate>>,
    busy: AtomicBool,
    pub installing: AtomicBool,
    cancel: watch::Sender<u64>,
}
impl Default for Updates {
    fn default() -> Self {
        Self {
            candidate: Mutex::new(None),
            busy: AtomicBool::new(false),
            installing: AtomicBool::new(false),
            cancel: watch::channel(0).0,
        }
    }
}
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst)
    }
}
fn acquire(updates: &Updates) -> Result<Busy<'_>, String> {
    updates
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "正在处理另一个更新请求，请稍候。".to_string())?;
    Ok(Busy(&updates.busy))
}
fn error(e: impl std::fmt::Display) -> String {
    format!("更新失败：{e}。当前版本仍可继续使用。")
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    current_version: String,
    releases_url: &'static str,
}
#[tauri::command]
pub fn app_update_status(app: AppHandle) -> Status {
    Status {
        current_version: app.package_info().version.to_string(),
        releases_url: RELEASES_URL,
    }
}

fn validate_release(version: &str, url: &url::Url) -> Result<(), String> {
    let version = semver::Version::parse(version).map_err(|_| "更新版本号无效。")?;
    if !version.pre.is_empty() {
        return Err("正式版更新源包含测试版本，已停止更新。".into());
    }
    #[cfg(feature = "update-qa")]
    if url.scheme() == "http" && url.host_str() == Some("127.0.0.1") {
        return Ok(());
    }
    let prefix = format!("/Yunz93/Modu/releases/download/v{version}/");
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().starts_with(&prefix)
        || !url.path().ends_with(".app.tar.gz")
    {
        return Err("更新包的来源或版本不匹配，已停止更新。".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn check_app_update(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Option<UpdateInfo>, String> {
    platform_update_check()?;
    let _busy = acquire(&state.updates)?;
    let mut cancel = state.updates.cancel.subscribe();
    let epoch = *cancel.borrow();
    *state.updates.candidate.lock().map_err(error)? = None;
    let mut builder = app.updater_builder().timeout(Duration::from_secs(30));
    #[cfg(feature = "update-qa")]
    if let Ok(endpoint) = std::env::var("MODU_QA_UPDATE_ENDPOINT") {
        let url = url::Url::parse(&endpoint).map_err(error)?;
        if url.host_str() != Some("127.0.0.1") {
            return Err("验收更新源必须是本机回环地址。".into());
        }
        builder = builder.endpoints(vec![url]).map_err(error)?;
    }
    builder = builder.version_comparator(|current, remote| {
        remote.version > current && remote.version.pre.is_empty()
    });
    let updater = builder.build().map_err(error)?;
    let update = tokio::select! {biased;_=cancel.changed()=>return Err("已取消检查更新。".into()),result=updater.check()=>result.map_err(|_|"暂时无法检查更新。请检查网络，或确认此版本的更新文件已经发布。".to_string())?};
    let Some(mut update) = update else {
        return Ok(None);
    };
    validate_release(&update.version, &update.download_url)?;
    update.timeout = Some(Duration::from_secs(300));
    let info = UpdateInfo {
        id: uuid::Uuid::new_v4().to_string(),
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        date: update.date.map(|d| d.to_string()),
    };
    let mut candidate = state.updates.candidate.lock().map_err(error)?;
    if *cancel.borrow() != epoch {
        return Err("已取消检查更新。".into());
    }
    *candidate = Some(Candidate {
        info: info.clone(),
        update,
        bytes: None,
    });
    Ok(Some(info))
}
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum Progress {
    Started {
        #[serde(rename = "contentLength")]
        content_length: Option<u64>,
    },
    Progress {
        #[serde(rename = "chunkLength")]
        chunk_length: usize,
    },
    Verifying,
    Ready,
}
#[tauri::command]
pub async fn download_app_update(
    state: tauri::State<'_, AppState>,
    id: String,
    on_event: Channel<Progress>,
) -> Result<(), String> {
    let _busy = acquire(&state.updates)?;
    let update = {
        let guard = state.updates.candidate.lock().map_err(error)?;
        let c = guard
            .as_ref()
            .filter(|c| c.info.id == id)
            .ok_or("更新已过期，请重新检查。")?;
        c.update.clone()
    };
    let mut cancel = state.updates.cancel.subscribe();
    let mut started = false;
    let progress = on_event.clone();
    let done = on_event.clone();
    let bytes = tokio::select! {biased;_=cancel.changed()=>return Err("下载已取消。".into()),result=update.download(move|chunk,total|{if !started {let _=progress.send(Progress::Started{content_length:total.filter(|n|*n>0)});started=true;}let _=progress.send(Progress::Progress{chunk_length:chunk});},move||{let _=done.send(Progress::Verifying);})=>result.map_err(error)?};
    update.verify(&bytes).map_err(error)?;
    let mut guard = state.updates.candidate.lock().map_err(error)?;
    let c = guard
        .as_mut()
        .filter(|c| c.info.id == id)
        .ok_or("下载已取消，请重新检查更新。")?;
    c.bytes = Some(bytes);
    let _ = on_event.send(Progress::Ready);
    Ok(())
}
#[tauri::command]
pub fn cancel_app_update(state: tauri::State<AppState>) -> Result<(), String> {
    if state.updates.installing.load(Ordering::SeqCst) {
        return Err("正在安装更新，请稍候。".into());
    }
    state.updates.cancel.send_modify(|value| *value += 1);
    *state.updates.candidate.lock().map_err(error)? = None;
    Ok(())
}
#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
    revision: i64,
) -> Result<(), String> {
    let _busy = acquire(&state.updates)?;
    if state.updates.installing.swap(true, Ordering::SeqCst) {
        return Err("正在安装更新。".into());
    }
    let _unlock = Busy(&state.updates.installing);
    // The frontend has frozen interaction and flushed the newest snapshot. Reject any later write.
    {
        let db = state.db.lock().map_err(error)?;
        let db = db.as_ref().map_err(Clone::clone)?;
        if db.revision()? != revision {
            return Err("阅读库在保存后发生变化，已取消安装，请重试。".into());
        }
        db.backup_before_update()?;
    }
    let candidate = state
        .updates
        .candidate
        .lock()
        .map_err(error)?
        .take()
        .filter(|c| c.info.id == id)
        .ok_or("更新已过期，请重新检查。")?;
    let bytes = candidate.bytes.ok_or("请先下载并验证更新包。")?;
    candidate.update.verify(&bytes).map_err(error)?;
    candidate.update.install(&bytes).map_err(error)?;
    state.exiting.store(true, Ordering::SeqCst);
    app.restart();
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn release_is_bound_to_repository_version_and_format() {
        let url = url::Url::parse(
            "https://github.com/Yunz93/Modu/releases/download/v0.1.2/Modu_0.1.2_aarch64.app.tar.gz",
        )
        .unwrap();
        assert!(validate_release("0.1.2", &url).is_ok());
        for u in [
            "https://github.com/other/repo/releases/download/v0.1.2/app.app.tar.gz",
            "https://github.com/Yunz93/Modu/releases/download/v0.1.1/app.app.tar.gz",
            "https://example.com/app.app.tar.gz",
            "https://github.com/Yunz93/Modu/releases/download/v0.1.2/app.dmg",
        ] {
            assert!(validate_release("0.1.2", &url::Url::parse(u).unwrap()).is_err())
        }
    }
    #[test]
    fn only_one_operation_owns_update_state() {
        let state = Updates::default();
        let guard = acquire(&state).unwrap();
        assert!(acquire(&state).is_err());
        drop(guard);
        assert!(acquire(&state).is_ok());
    }
}
