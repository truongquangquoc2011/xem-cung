#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use tokio::net::TcpListener;
use url::Url;
use wreq::Client;
use wreq_util::Emulation;

struct ProxyPort(Arc<AtomicU16>);

#[derive(Clone)]
struct ProxyState {
    client: Client,
}

#[derive(Deserialize)]
struct SegQuery {
    url: String,
    host: Option<String>,
}

fn is_blocked_host(host: &str) -> bool {
    let h = host.trim().to_ascii_lowercase();
    let h = h.trim_start_matches('[').trim_end_matches(']');
    if h.is_empty() || h == "localhost" || h.ends_with(".local") || h.ends_with(".internal") {
        return true;
    }
    if let Ok(ip) = h.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => {
                let o = v4.octets();
                o[0] == 0
                    || o[0] == 10
                    || o[0] == 127
                    || (o[0] == 169 && o[1] == 254)
                    || (o[0] == 172 && (16..=31).contains(&o[1]))
                    || (o[0] == 192 && o[1] == 168)
                    || (o[0] == 100 && (64..=127).contains(&o[1]))
            }
            IpAddr::V6(v6) => {
                v6.is_loopback()
                    || v6.is_unspecified()
                    || (v6.segments()[0] & 0xfe00) == 0xfc00
                    || (v6.segments()[0] & 0xffc0) == 0xfe80
            }
        };
    }
    false
}

fn resolve_origin_host(host_param: Option<&str>, fallback_host: &str) -> String {
    let Some(raw) = host_param.map(str::trim).filter(|s| !s.is_empty()) else {
        return fallback_host.to_string();
    };
    if raw.ends_with(".streamvsmov.com") {
        return "v10.streamvsmov.com".to_string();
    }
    if raw.ends_with(".streamc.xyz") {
        return raw.to_string();
    }
    fallback_host.to_string()
}

async fn seg_handler(
    method: Method,
    State(state): State<ProxyState>,
    Query(q): Query<SegQuery>,
) -> impl IntoResponse {
    let mut cors = HeaderMap::new();
    cors.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    cors.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, HEAD, OPTIONS"),
    );
    cors.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("*"));

    if method == Method::OPTIONS {
        return (StatusCode::NO_CONTENT, cors, Body::empty()).into_response();
    }

    let Ok(parsed) = Url::parse(q.url.trim()) else {
        return (StatusCode::BAD_REQUEST, cors, "Invalid segment URL").into_response();
    };
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return (StatusCode::BAD_REQUEST, cors, "Invalid protocol").into_response();
    }
    let Some(target_host) = parsed.host_str() else {
        return (StatusCode::BAD_REQUEST, cors, "Missing host").into_response();
    };
    if is_blocked_host(target_host) {
        return (StatusCode::BAD_REQUEST, cors, "Blocked host").into_response();
    }

    let origin_host = resolve_origin_host(q.host.as_deref(), target_host);
    let req_builder = state
        .client
        .get(parsed.as_str())
        .header("Origin", format!("https://{origin_host}"))
        .header("Referer", format!("https://{origin_host}/"));

    let upstream = match req_builder.send().await {
        Ok(res) => res,
        Err(err) => {
            return (
                StatusCode::BAD_GATEWAY,
                cors,
                format!("Upstream error: {err}"),
            )
                .into_response();
        }
    };

    let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    if !upstream.status().is_success() {
        return (status, cors, "Upstream returned error").into_response();
    }

    let content_type = upstream
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("video/mp2t")
        .to_string();

    if let Ok(val) = HeaderValue::from_str(&content_type) {
        cors.insert(header::CONTENT_TYPE, val);
    }
    cors.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=21600"),
    );

    let stream = upstream.bytes_stream();
    (StatusCode::OK, cors, Body::from_stream(stream)).into_response()
}

#[tauri::command]
fn get_proxy_port(state: tauri::State<'_, ProxyPort>) -> u16 {
    state.0.load(Ordering::Relaxed)
}

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
async fn install_update(url: String, app: tauri::AppHandle) -> Result<(), String> {
    if !url.starts_with("https://github.com/truongquangquoc2011/xem-cung/releases/download/") {
        return Err("URL cập nhật không hợp lệ".to_string());
    }

    let client = Client::builder()
        .emulation(Emulation::Chrome131)
        .build()
        .map_err(|e| e.to_string())?;

    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Tải bản cập nhật thất bại (HTTP {})", res.status()));
    }

    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let temp_path = std::env::temp_dir().join("xem-cung-update-setup.exe");
    std::fs::write(&temp_path, &bytes).map_err(|e| e.to_string())?;

    std::process::Command::new(&temp_path)
        .spawn()
        .map_err(|e| e.to_string())?;

    app.exit(0);
    Ok(())
}

fn spawn_local_proxy() -> Arc<AtomicU16> {
    let port_holder = Arc::new(AtomicU16::new(0));
    let port_clone = Arc::clone(&port_holder);

    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("tokio runtime");

        rt.block_on(async move {
            let client = Client::builder()
                .emulation(Emulation::Chrome131)
                .pool_max_idle_per_host(8)
                .build()
                .expect("wreq client");

            let app = Router::new()
                .route("/seg", get(seg_handler).head(seg_handler).options(seg_handler))
                .with_state(ProxyState { client });

            let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
                .await
                .expect("bind local proxy");
            let bound_port = listener.local_addr().expect("local_addr").port();
            port_clone.store(bound_port, Ordering::Relaxed);

            let _ = axum::serve(listener, app).await;
        });
    });

    // Chờ proxy bind xong port (< 5ms)
    while port_holder.load(Ordering::Relaxed) == 0 {
        std::thread::sleep(std::time::Duration::from_millis(1));
    }
    port_holder
}

fn main() {
    let port = spawn_local_proxy();

    tauri::Builder::default()
        .manage(ProxyPort(port))
        .invoke_handler(tauri::generate_handler![
            get_proxy_port,
            get_app_version,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running Xem Cung desktop");
}
