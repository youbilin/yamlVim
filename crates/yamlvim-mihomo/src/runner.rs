use std::fmt;
use std::io::{self, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct CommandSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub timeout: Duration,
}

#[derive(Debug, Clone, Default)]
pub struct CommandOutput {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

impl CommandOutput {
    pub fn success(&self) -> bool {
        !self.timed_out && self.status == Some(0)
    }

    pub fn combined(&self) -> String {
        let mut text = String::new();
        if !self.stdout.trim().is_empty() {
            text.push_str(self.stdout.trim());
        }
        if !self.stderr.trim().is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(self.stderr.trim());
        }
        text
    }
}

#[derive(Debug)]
pub enum RunnerError {
    Spawn(io::Error),
    Io(io::Error),
}

impl fmt::Display for RunnerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Spawn(error) => write!(formatter, "failed to start process: {error}"),
            Self::Io(error) => write!(formatter, "process I/O failed: {error}"),
        }
    }
}

impl std::error::Error for RunnerError {}

impl From<io::Error> for RunnerError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

pub trait CommandRunner {
    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, RunnerError>;
}

pub struct SystemRunner;

impl CommandRunner for SystemRunner {
    fn run(&self, spec: &CommandSpec) -> Result<CommandOutput, RunnerError> {
        let mut command = Command::new(&spec.program);
        command
            .args(&spec.args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW: probe a CLI core without flashing a console.
            command.creation_flags(0x0800_0000);
        }

        let mut child = command.spawn().map_err(RunnerError::Spawn)?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| RunnerError::Io(io::Error::other("stdout pipe missing")))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| RunnerError::Io(io::Error::other("stderr pipe missing")))?;

        let stdout_reader = thread::spawn(move || read_all(stdout));
        let stderr_reader = thread::spawn(move || read_all(stderr));

        let started = Instant::now();
        let mut timed_out = false;
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) => {
                    if started.elapsed() >= spec.timeout {
                        let _ = child.kill();
                        let _ = child.wait();
                        timed_out = true;
                        break None;
                    }
                    thread::sleep(Duration::from_millis(20));
                }
                Err(error) => {
                    let _ = child.kill();
                    return Err(RunnerError::Io(error));
                }
            }
        };

        let stdout = join_reader(stdout_reader)?;
        let stderr = join_reader(stderr_reader)?;

        Ok(CommandOutput {
            status,
            stdout,
            stderr,
            timed_out,
        })
    }
}

fn join_reader(handle: thread::JoinHandle<io::Result<String>>) -> Result<String, RunnerError> {
    handle
        .join()
        .map_err(|_| RunnerError::Io(io::Error::other("reader thread panicked")))?
        .map_err(RunnerError::Io)
}

fn read_all(mut reader: impl Read) -> io::Result<String> {
    let mut buffer = String::new();
    reader.read_to_string(&mut buffer)?;
    Ok(buffer)
}
