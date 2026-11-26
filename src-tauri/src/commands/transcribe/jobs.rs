//! Which transcription jobs exist, whose turn it is, and how to stop one.
//!
//! Jobs used to be serialised only at the Whisper lock, which is taken AFTER
//! a job has decoded its audio: two jobs started together each held a decoded
//! file in memory while one of them waited. Here a job takes its turn before
//! it touches the file, so a waiting job costs nothing.
//!
//! A job can be cancelled while it waits (it never starts) or while it runs
//! (the flag is polled by the decoder loop and by Whisper's abort callback).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};

/// How many transcriptions may run at once. One: Whisper already uses every
/// core, and each job needs the model's memory.
pub const MAX_CONCURRENT_TRANSCRIPTIONS: usize = 1;

/// Unload the model this long after the last job finished. It holds
/// 0.6 to 1 GB that an idle app should give back; loading it again takes a
/// few seconds, which is nothing next to a transcription.
pub const IDLE_UNLOAD_SECS: u64 = 10 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobKind {
    Transcription,
    Import,
}

pub struct JobHandle {
    serial: u64,
    pub kind: JobKind,
    pub job_id: Option<String>,
    /// The `path` the job was started with (for an import, the source file).
    pub path: String,
    /// The model the job uses (transcriptions only).
    pub model: Option<String>,
    pub cancel: Arc<AtomicBool>,
    running: AtomicBool,
    wake: Notify,
}

impl JobHandle {
    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }
}

pub struct JobRegistry {
    jobs: Mutex<Vec<Arc<JobHandle>>>,
    turns: Arc<Semaphore>,
    next_serial: AtomicU64,
}

impl JobRegistry {
    pub fn new(concurrent: usize) -> Arc<Self> {
        Arc::new(Self {
            jobs: Mutex::new(Vec::new()),
            turns: Arc::new(Semaphore::new(concurrent.max(1))),
            next_serial: AtomicU64::new(1),
        })
    }

    /// The one registry of the running app.
    pub fn global() -> Arc<Self> {
        static GLOBAL: OnceLock<Arc<JobRegistry>> = OnceLock::new();
        GLOBAL.get_or_init(|| JobRegistry::new(MAX_CONCURRENT_TRANSCRIPTIONS)).clone()
    }

    /// Enter a job. It is listed (and cancellable) until the ticket is
    /// dropped.
    pub fn register(
        self: &Arc<Self>,
        kind: JobKind,
        job_id: Option<String>,
        path: String,
        model: Option<String>,
    ) -> JobTicket {
        let handle = Arc::new(JobHandle {
            serial: self.next_serial.fetch_add(1, Ordering::Relaxed),
            kind,
            job_id,
            path,
            model,
            cancel: Arc::new(AtomicBool::new(false)),
            running: AtomicBool::new(false),
            wake: Notify::new(),
        });
        self.lock_jobs().push(handle.clone());
        JobTicket { registry: self.clone(), handle, permit: None }
    }

    /// Cancel every listed job whose id or path matches. Returns whether any
    /// did. Both `None` matches nothing.
    pub fn cancel(&self, job_id: Option<&str>, path: Option<&str>) -> bool {
        let mut any = false;
        for job in self.lock_jobs().iter() {
            let by_id = matches!((job_id, job.job_id.as_deref()), (Some(a), Some(b)) if a == b);
            let by_path = matches!(path, Some(p) if p == job.path);
            if by_id || by_path {
                job.cancel.store(true, Ordering::Relaxed);
                // Stored if the job is not waiting yet, so it cannot be missed.
                job.wake.notify_one();
                any = true;
            }
        }
        any
    }

    /// The model of the transcription that is running now, if any.
    pub fn running_model(&self) -> Option<String> {
        self.lock_jobs()
            .iter()
            .find(|j| j.kind == JobKind::Transcription && j.is_running())
            .and_then(|j| j.model.clone())
    }

    /// Whether any listed transcription, running or waiting, uses `model`.
    pub fn uses_model(&self, model: &str) -> bool {
        self.lock_jobs()
            .iter()
            .any(|j| j.kind == JobKind::Transcription && j.model.as_deref() == Some(model))
    }

    /// `(running, waiting)` transcription jobs.
    #[cfg(test)]
    pub fn counts(&self) -> (usize, usize) {
        let jobs = self.lock_jobs();
        let transcriptions = jobs.iter().filter(|j| j.kind == JobKind::Transcription);
        let running = transcriptions.clone().filter(|j| j.is_running()).count();
        (running, transcriptions.count() - running)
    }

    fn lock_jobs(&self) -> std::sync::MutexGuard<'_, Vec<Arc<JobHandle>>> {
        self.jobs.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn remove(&self, serial: u64) {
        self.lock_jobs().retain(|j| j.serial != serial);
    }
}

/// A job's place in the registry. Dropping it removes the job and, if it had
/// its turn, lets the next one start. Move it into the task that does the
/// work, so the turn is held for exactly as long as the work runs.
pub struct JobTicket {
    registry: Arc<JobRegistry>,
    handle: Arc<JobHandle>,
    permit: Option<OwnedSemaphorePermit>,
}

impl JobTicket {
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn handle(&self) -> &Arc<JobHandle> {
        &self.handle
    }

    pub fn cancel_flag(&self) -> Arc<AtomicBool> {
        self.handle.cancel.clone()
    }

    /// Wait for this job's turn. `Err(())` when it was cancelled first; a
    /// job cancelled while waiting never gets a turn.
    pub async fn wait_turn(&mut self) -> Result<(), ()> {
        if self.handle.is_cancelled() {
            return Err(());
        }
        let turns = self.registry.turns.clone();
        tokio::select! {
            biased;
            _ = self.handle.wake.notified() => Err(()),
            permit = turns.acquire_owned() => {
                // Closed semaphores do not happen (it is never closed).
                let permit = permit.map_err(|_| ())?;
                if self.handle.is_cancelled() {
                    return Err(());
                }
                self.permit = Some(permit);
                self.handle.running.store(true, Ordering::Relaxed);
                Ok(())
            }
        }
    }

    /// Mark a job that does not queue (an import) as running.
    pub fn start_unqueued(&mut self) {
        self.handle.running.store(true, Ordering::Relaxed);
    }
}

impl Drop for JobTicket {
    fn drop(&mut self) {
        self.handle.running.store(false, Ordering::Relaxed);
        self.registry.remove(self.handle.serial);
        // `permit` drops after this body: the next job starts once this one
        // is no longer listed.
    }
}

/// Decides whether an idle timer that was armed after one job may unload the
/// model: only if no job has started or finished since.
#[derive(Default)]
pub struct IdleTracker {
    generation: AtomicU64,
}

impl IdleTracker {
    pub fn global() -> &'static IdleTracker {
        static GLOBAL: OnceLock<IdleTracker> = OnceLock::new();
        GLOBAL.get_or_init(IdleTracker::default)
    }

    /// Note activity. Returns the token an idle timer armed now should hold.
    pub fn touch(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// True when nothing has happened since `token` was issued.
    pub fn is_current(&self, token: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == token
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn job(reg: &Arc<JobRegistry>, id: &str, path: &str) -> JobTicket {
        reg.register(JobKind::Transcription, Some(id.into()), path.into(), Some("small".into()))
    }

    #[tokio::test]
    async fn jobs_take_turns_in_arrival_order() {
        let reg = JobRegistry::new(1);
        let mut a = job(&reg, "a", "/a.wav");
        let mut b = job(&reg, "b", "/b.wav");
        let mut c = job(&reg, "c", "/c.wav");

        a.wait_turn().await.unwrap();
        assert_eq!(reg.counts(), (1, 2));
        assert_eq!(reg.running_model().as_deref(), Some("small"));
        // A model is "in use" while a job runs with it or waits for it.
        assert!(reg.uses_model("small"));
        assert!(!reg.uses_model("large-v3-turbo-q5_0"));

        let order = Arc::new(Mutex::new(Vec::new()));
        let (ob, oc) = (order.clone(), order.clone());
        let tb = tokio::spawn(async move {
            b.wait_turn().await.unwrap();
            ob.lock().unwrap().push("b");
            tokio::time::sleep(Duration::from_millis(20)).await;
            drop(b);
        });
        tokio::time::sleep(Duration::from_millis(10)).await;
        let tc = tokio::spawn(async move {
            c.wait_turn().await.unwrap();
            oc.lock().unwrap().push("c");
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(order.lock().unwrap().is_empty(), "a job started while another held the turn");

        drop(a);
        tb.await.unwrap();
        tc.await.unwrap();
        assert_eq!(*order.lock().unwrap(), vec!["b", "c"]);
        assert_eq!(reg.counts(), (0, 0));
        assert_eq!(reg.running_model(), None);
        assert!(!reg.uses_model("small"), "a finished job no longer holds its model");
    }

    #[tokio::test]
    async fn a_waiting_job_can_be_cancelled_and_never_starts() {
        let reg = JobRegistry::new(1);
        let mut a = job(&reg, "a", "/a.wav");
        let mut b = job(&reg, "b", "/b.wav");
        a.wait_turn().await.unwrap();

        let waiting = tokio::spawn(async move {
            let r = b.wait_turn().await;
            (r, b.handle().is_running())
        });
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(reg.cancel(Some("b"), None));
        let (result, running) = waiting.await.unwrap();
        assert!(result.is_err());
        assert!(!running);

        // The turn was not consumed: a third job starts as soon as `a` ends.
        drop(a);
        let mut c = job(&reg, "c", "/c.wav");
        tokio::time::timeout(Duration::from_secs(1), c.wait_turn()).await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn a_cancel_that_arrives_before_the_wait_is_not_lost() {
        let reg = JobRegistry::new(1);
        let mut a = job(&reg, "a", "/a.wav");
        assert!(reg.cancel(None, Some("/a.wav")));
        assert!(a.wait_turn().await.is_err());
        assert!(a.handle().is_cancelled());
    }

    #[tokio::test]
    async fn a_running_job_is_cancelled_through_its_flag() {
        let reg = JobRegistry::new(1);
        let mut a = job(&reg, "a", "/a.wav");
        a.wait_turn().await.unwrap();
        let flag = a.cancel_flag();
        assert!(!flag.load(Ordering::Relaxed));
        assert!(reg.cancel(Some("a"), None));
        assert!(flag.load(Ordering::Relaxed));
        // Still listed until the work actually stops and drops the ticket.
        assert_eq!(reg.counts(), (1, 0));
        drop(a);
        assert_eq!(reg.counts(), (0, 0));
        // Nothing left to cancel.
        assert!(!reg.cancel(Some("a"), None));
    }

    #[tokio::test]
    async fn cancel_matches_by_id_or_path_and_nothing_matches_nothing() {
        let reg = JobRegistry::new(1);
        let a = job(&reg, "a", "/a.wav");
        let b = reg.register(JobKind::Transcription, None, "/b.wav".into(), None);
        let imp = reg.register(JobKind::Import, None, "/video.mp4".into(), None);

        assert!(!reg.cancel(None, None));
        assert!(!reg.cancel(Some("zzz"), Some("/zzz.wav")));
        assert!(!a.handle().is_cancelled());

        assert!(reg.cancel(None, Some("/b.wav")));
        assert!(b.handle().is_cancelled() && !a.handle().is_cancelled());

        assert!(reg.cancel(None, Some("/video.mp4")));
        assert!(imp.handle().is_cancelled());

        // A job without an id is not matched by an id.
        assert!(reg.cancel(Some("a"), Some("/nope")));
        assert!(a.handle().is_cancelled());

        // Imports do not count as transcriptions.
        assert_eq!(reg.counts(), (0, 2));
    }

    #[tokio::test]
    async fn an_import_does_not_take_a_transcription_turn() {
        let reg = JobRegistry::new(1);
        let mut imp = reg.register(JobKind::Import, None, "/video.mp4".into(), None);
        imp.start_unqueued();
        let mut a = job(&reg, "a", "/a.wav");
        tokio::time::timeout(Duration::from_secs(1), a.wait_turn()).await.unwrap().unwrap();
        assert_eq!(reg.running_model().as_deref(), Some("small"));
    }

    #[test]
    fn an_idle_timer_only_fires_if_nothing_happened_since() {
        let idle = IdleTracker::default();
        let after_first = idle.touch();
        assert!(idle.is_current(after_first));
        // A second job starts and ends before the first timer fires.
        let _started = idle.touch();
        let after_second = idle.touch();
        assert!(!idle.is_current(after_first), "a stale timer must not unload the model");
        assert!(idle.is_current(after_second));
    }

    #[test]
    fn the_constants_are_what_the_docs_say() {
        assert_eq!(MAX_CONCURRENT_TRANSCRIPTIONS, 1);
        assert_eq!(IDLE_UNLOAD_SECS, 600);
    }
}
