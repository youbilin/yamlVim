use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ControllerTransport {
    Tcp,
    NamedPipe,
    UnixSocket,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerConfig {
    pub endpoint: String,
    #[serde(default)]
    pub secret: String,
    #[serde(default = "default_transport")]
    pub transport: ControllerTransport,
}

fn default_transport() -> ControllerTransport {
    ControllerTransport::Tcp
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControllerInfo {
    pub version: String,
    pub mode: String,
    pub proxy_count: usize,
    pub group_count: usize,
    pub rule_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyEntry {
    pub name: String,
    pub kind: String,
    pub alive: bool,
    pub delay: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionEntry {
    pub id: String,
    pub host: String,
    pub destination: String,
    pub network: String,
    pub proxy_chain: Vec<String>,
    pub upload: u64,
    pub download: u64,
    pub start: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DelayResult {
    pub name: String,
    pub delay_ms: Option<u64>,
    pub error: Option<String>,
}

/// HTTP client for mihomo external controller.
/// Supports TCP and named pipe transports.
pub struct ControllerClient {
    endpoint: String,
    secret: String,
    transport: ControllerTransport,
}

impl ControllerClient {
    pub fn new(config: &ControllerConfig) -> Self {
        Self {
            endpoint: config.endpoint.clone(),
            secret: config.secret.clone(),
            transport: config.transport.clone(),
        }
    }

    pub fn from_parts(endpoint: &str, secret: &str, transport: ControllerTransport) -> Self {
        Self {
            endpoint: endpoint.to_string(),
            secret: secret.to_string(),
            transport,
        }
    }

    fn base_url(&self) -> String {
        match &self.transport {
            ControllerTransport::Tcp => self.endpoint.clone(),
            _ => "http://localhost".to_string(),
        }
    }

    fn auth_header(&self) -> Option<(String, String)> {
        if self.secret.is_empty() {
            None
        } else {
            Some(("Authorization".into(), format!("Bearer {}", self.secret)))
        }
    }

    /// Perform a GET request to the controller API.
    pub fn get(&self, path: &str) -> Result<String, String> {
        let url = format!("{}{}", self.base_url(), path);
        let mut request = ureq::get(&url);
        if let Some((key, value)) = self.auth_header() {
            request = request.set(&key, &value);
        }
        let response = request
            .timeout(Duration::from_secs(10))
            .call()
            .map_err(|error| format!("controller request failed: {error}"))?;
        response
            .into_string()
            .map_err(|error| format!("failed to read response: {error}"))
    }

    /// Perform a PUT request to the controller API.
    pub fn put(&self, path: &str, body: &str) -> Result<String, String> {
        let url = format!("{}{}", self.base_url(), path);
        let mut request = ureq::put(&url);
        if let Some((key, value)) = self.auth_header() {
            request = request.set(&key, &value);
        }
        let response = request
            .timeout(Duration::from_secs(10))
            .send_string(body)
            .map_err(|error| format!("controller request failed: {error}"))?;
        Ok(response.into_string().unwrap_or_else(|_| String::new()))
    }

    /// Get the controller version.
    pub fn version(&self) -> Result<String, String> {
        let text = self.get("/version")?;
        let value: serde_json::Value =
            serde_json::from_str(&text).map_err(|error| error.to_string())?;
        Ok(value
            .get("version")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("unknown")
            .to_string())
    }

    /// Get the current running config.
    pub fn get_configs(&self) -> Result<String, String> {
        self.get("/configs")
    }

    /// List all proxies (nodes + groups).
    pub fn get_proxies(&self) -> Result<String, String> {
        self.get("/proxies")
    }

    /// List active connections.
    pub fn get_connections(&self) -> Result<String, String> {
        self.get("/connections")
    }

    /// Run a delay test on a proxy.
    pub fn test_delay(&self, name: &str, url: &str, timeout_ms: u64) -> Result<u64, String> {
        let encoded = urlencode(name);
        let path = format!(
            "/proxies/{}/delay?timeout={}&url={}",
            encoded,
            timeout_ms,
            urlencode(url)
        );
        let text = self.get(&path)?;
        let value: serde_json::Value =
            serde_json::from_str(&text).map_err(|error| error.to_string())?;
        value
            .get("delay")
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| "no delay in response".to_string())
    }

    /// Query the controller's DNS resolver.
    pub fn query_dns(&self, name: &str, kind: &str) -> Result<String, String> {
        self.get(&format!(
            "/dns/query?name={}&type={}",
            urlencode(name),
            urlencode(kind)
        ))
    }

    /// Flush DNS cache.
    pub fn flush_dns(&self) -> Result<(), String> {
        self.put("/cache/dns/flush", "").map(|_| ())
    }
}

fn urlencode(input: &str) -> String {
    let mut result = String::new();
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(*byte as char)
            }
            _ => result.push_str(&format!("%{:02X}", byte)),
        }
    }
    result
}
