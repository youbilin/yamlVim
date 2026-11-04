use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SHARE_TTL_MS: u64 = 30 * 60_000;

struct ShareEntry {
    yaml: String,
    expires_at: u64,
}

pub struct ShareInfo {
    pub url: String,
    pub scheme_url: String,
    pub expires_at: u64,
}

pub struct ShareServer {
    entries: Arc<Mutex<HashMap<String, ShareEntry>>>,
    port: Option<u16>,
}

impl ShareServer {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(HashMap::new())),
            port: None,
        }
    }

    pub fn publish(&mut self, yaml: String) -> Result<ShareInfo, String> {
        let now = now_millis();
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "分享服务锁不可用".to_string())?;
        entries.retain(|_, entry| entry.expires_at > now);
        let token = random_token();
        entries.insert(token.clone(), ShareEntry {
            yaml,
            expires_at: now + SHARE_TTL_MS,
        });
        if self.port.is_none() {
            let listener = TcpListener::bind(("127.0.0.1", 0))
                .map_err(|error| format!("无法启动本地订阅服务：{error}"))?;
            let port = listener
                .local_addr()
                .map_err(|error| format!("无法读取本地订阅端口：{error}"))?
                .port();
            self.port = Some(port);
            let entries = self.entries.clone();
            std::thread::Builder::new()
                .name("yamlvim-share".to_string())
                .spawn(move || serve(listener, entries))
                .map_err(|error| format!("无法启动订阅线程：{error}"))?;
        }
        let url = format!(
            "http://127.0.0.1:{}/share/clash/{}.yaml",
            self.port.unwrap_or(0),
            token
        );
        Ok(ShareInfo {
            scheme_url: format!("clash://install-config?url={}", percent_encode(&url)),
            url,
            expires_at: now + SHARE_TTL_MS,
        })
    }
}

fn serve(listener: TcpListener, entries: Arc<Mutex<HashMap<String, ShareEntry>>>) {
    for stream in listener.incoming() {
        if let Ok(stream) = stream {
            let entries = entries.clone();
            let _ = std::thread::Builder::new()
                .name("yamlvim-share-request".to_string())
                .spawn(move || handle_request(stream, entries));
        } else {
            break;
        }
    }
}

fn handle_request(mut stream: TcpStream, entries: Arc<Mutex<HashMap<String, ShareEntry>>>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let mut buffer = [0u8; 8192];
    let read = stream.read(&mut buffer).unwrap_or(0);
    let request = String::from_utf8_lossy(&buffer[..read]);
    let mut parts = request.lines().next().unwrap_or("").split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    let token = path
        .strip_prefix("/share/clash/")
        .and_then(|rest| rest.strip_suffix(".yaml"))
        .unwrap_or("");
    let now = now_millis();
    let yaml = entries.lock().ok().and_then(|entries| {
        entries
            .get(token)
            .filter(|entry| entry.expires_at > now)
            .map(|entry| entry.yaml.clone())
    });
    let Some(yaml) = yaml else {
        respond(&mut stream, 404, "text/plain", "分享链接已失效");
        return;
    };
    match method {
        "HEAD" => respond_head(&mut stream, &yaml),
        "GET" => respond(&mut stream, 200, "text/yaml", &yaml),
        _ => respond(&mut stream, 405, "text/plain", "Method Not Allowed"),
    }
}

fn respond(stream: &mut TcpStream, status: u16, content_type: &str, body: &str) {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn respond_head(stream: &mut TcpStream, yaml: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/yaml; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        yaml.len()
    );
    let _ = stream.write_all(response.as_bytes());
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn random_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0);
    let pid = std::process::id() as u64;
    format!("{:016x}{:08x}", nanos.rotate_left(17) ^ (pid << 1), pid)
}

fn percent_encode(url: &str) -> String {
    let mut encoded = String::with_capacity(url.len() + 16);
    for byte in url.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}


#[cfg(test)]
mod tests {
    use super::ShareServer;

    #[test]
    fn published_url_serves_yaml() {
        let mut server = ShareServer::new();
        let first = server.publish("proxies: []\n".into()).unwrap();
        let second = server.publish("rules: []\n".into()).unwrap();
        assert_ne!(first.url, second.url);
        let authority = |url: &str| {
            url.trim_start_matches("http://")
                .split('/')
                .next()
                .unwrap()
                .to_string()
        };
        assert_eq!(authority(&first.url), authority(&second.url));
        assert!(first.scheme_url.starts_with("clash://install-config?url=http%3A%2F%2F127.0.0.1%3A"));

        let body = http_get(&first.url);
        assert_eq!(body, "proxies: []\n");

    }

    fn http_get(url: &str) -> String {
        let authority = url
            .trim_start_matches("http://")
            .split('/')
            .next()
            .unwrap()
            .to_string();
        let path = format!("/{}", url.splitn(4, '/').nth(3).unwrap_or(""));
        let mut stream = std::net::TcpStream::connect(authority).unwrap();
        use std::io::{Read, Write};
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response.split("\r\n\r\n").nth(1).unwrap().to_string()
    }
}

