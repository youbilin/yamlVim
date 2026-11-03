use std::fmt;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use serde::Serialize;

#[derive(Debug)]
pub enum ProcessError {
    Io(io::Error),
}

impl fmt::Display for ProcessError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "core process error: {error}"),
        }
    }
}

impl std::error::Error for ProcessError {}

impl From<io::Error> for ProcessError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreStatus {
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    pub log_path: String,
}

pub fn build_args(config: &Path, data_dir: &Path) -> Vec<String> {
    vec![
        "-d".into(),
        data_dir.display().to_string(),
        "-f".into(),
        config.display().to_string(),
    ]
}

pub struct CoreProcess {
    child: Child,
    log_path: PathBuf,
}

impl CoreProcess {
    pub fn start(
        binary: &Path,
        config: &Path,
        data_dir: &Path,
        log_path: &Path,
    ) -> Result<Self, ProcessError> {
        fs::create_dir_all(data_dir)?;
        if let Some(parent) = log_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let log = File::create(log_path)?;
        let stderr = log.try_clone()?;
        let mut command = Command::new(binary);
        command
            .args(build_args(config, data_dir))
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(stderr));

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }

        let child = command.spawn()?;
        Ok(Self {
            child,
            log_path: log_path.to_path_buf(),
        })
    }

    pub fn status(&mut self) -> Result<CoreStatus, ProcessError> {
        let running = self.child.try_wait()?.is_none();
        Ok(CoreStatus {
            running,
            pid: if running { Some(self.child.id()) } else { None },
            log_path: self.log_path.display().to_string(),
        })
    }

    pub fn stop(&mut self) -> Result<(), ProcessError> {
        if self.child.try_wait()?.is_none() {
            let _ = self.child.kill();
        }
        let _ = self.child.wait();
        Ok(())
    }
}

impl Drop for CoreProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
