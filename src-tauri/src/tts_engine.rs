use crate::{db, settings, tts, AppState};
use ort::ep::CPU;
use ort::session::{builder::GraphOptimizationLevel, RunOptions, Session};
use ort::value::Tensor;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

// Includes the two padding tokens; the model itself supports up to 512.
const MAX_TOKENS: usize = 160;

struct ActiveSpeech {
    id: String,
    options: Arc<RunOptions>,
}

#[derive(Default)]
pub struct SpeechEngine {
    session: Mutex<Option<Session>>,
    active: Mutex<Option<ActiveSpeech>>,
}

fn fail(error: impl std::fmt::Display) -> String {
    error.to_string()
}

impl SpeechEngine {
    pub fn start(&self, id: String) -> Result<(), String> {
        let mut active = self.active.lock().map_err(fail)?;
        if let Some(previous) = active.take() {
            let _ = previous.options.terminate();
        }
        *active = Some(ActiveSpeech {
            id,
            options: Arc::new(RunOptions::new().map_err(fail)?),
        });
        Ok(())
    }

    pub fn cancel(&self, id: &str) -> Result<(), String> {
        let mut active = self.active.lock().map_err(fail)?;
        if active.as_ref().is_some_and(|speech| speech.id == id) {
            if let Some(speech) = active.take() {
                speech.options.terminate().map_err(fail)?;
            }
        }
        Ok(())
    }

    pub fn release_if_idle(&self) -> Result<(), String> {
        // In-flight inference returns before the session and its allocations are released.
        let mut session = self.session.lock().map_err(fail)?;
        if self.active.lock().map_err(fail)?.is_none() {
            *session = None;
        }
        Ok(())
    }

    fn options(&self, id: &str) -> Result<Arc<RunOptions>, String> {
        self.active
            .lock()
            .map_err(fail)?
            .as_ref()
            .filter(|speech| speech.id == id)
            .map(|speech| Arc::clone(&speech.options))
            .ok_or_else(|| "Speech playback was stopped.".into())
    }

    pub fn synthesize(&self, id: &str, voice: &str, tokens: Vec<i64>) -> Result<Vec<u8>, String> {
        if !tts::valid_voice(voice)
            || !(3..=MAX_TOKENS).contains(&tokens.len())
            || !tokens.iter().any(|token| *token >= 24)
            || tokens.first() != Some(&0)
            || tokens.last() != Some(&0)
            || tokens.iter().any(|token| !(0..=177).contains(token))
        {
            return Err("Invalid Kokoro voice or phoneme input.".into());
        }
        let options = self.options(id)?;
        let conn = db::ensure_db().map_err(fail)?;
        if !settings::get_settings(&conn).map_err(fail)?.tts_enabled {
            return Err("Text to speech is disabled in settings.".into());
        }
        drop(conn);
        let model_path = tts::cached_asset("onnx/model_quantized.onnx")?;
        let voice_path = tts::cached_asset(&format!("voices/{voice}.bin"))?;
        let voice_bytes = std::fs::read(voice_path).map_err(fail)?;
        let offset = (tokens.len() - 2).min(509) * 256 * 4;
        let style = voice_bytes
            .get(offset..offset + 256 * 4)
            .ok_or("Invalid Kokoro voice file. Retry the download in settings.")?
            .chunks_exact(4)
            .map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
            .collect::<Vec<_>>();

        let mut cached = self.session.lock().map_err(fail)?;
        self.options(id)?;
        if cached.is_none() {
            let session = Session::builder()
                .map_err(fail)?
                .with_execution_providers([CPU::default().with_arena_allocator(false).build()])
                .map_err(fail)?
                .with_intra_threads(1)
                .map_err(fail)?
                .with_inter_threads(1)
                .map_err(fail)?
                .with_parallel_execution(false)
                .map_err(fail)?
                .with_intra_op_spinning(false)
                .map_err(fail)?
                .with_inter_op_spinning(false)
                .map_err(fail)?
                .with_memory_pattern(false)
                .map_err(fail)?
                .with_optimization_level(GraphOptimizationLevel::Level3)
                .map_err(fail)?
                .commit_from_file(model_path)
                .map_err(fail)?;
            *cached = Some(session);
        }
        self.options(id)?;
        let session = cached.as_mut().ok_or("Speech session is unavailable.")?;
        let inputs = ort::inputs! {
            "input_ids" => Tensor::from_array(([1, tokens.len()], tokens)).map_err(fail)?,
            "style" => Tensor::from_array(([1, 256], style)).map_err(fail)?,
            "speed" => Tensor::from_array(([1], vec![1.0f32])).map_err(fail)?,
        };
        let outputs = session.run_with_options(inputs, &options).map_err(fail)?;
        let (_, samples) = outputs[0].try_extract_tensor::<f32>().map_err(fail)?;
        if samples.is_empty()
            || samples.len() > 24_000 * 120
            || samples.iter().any(|sample| !sample.is_finite())
        {
            return Err("Kokoro returned invalid audio.".into());
        }
        let mut bytes = Vec::with_capacity(samples.len() * 4);
        for sample in samples {
            bytes.extend_from_slice(&sample.clamp(-1.0, 1.0).to_le_bytes());
        }
        self.options(id)?;
        Ok(bytes)
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn start_tts(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.speech.start(session_id)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn synthesize_tts(
    app: AppHandle,
    session_id: String,
    voice: String,
    tokens: Vec<i64>,
) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>()
            .speech
            .synthesize(&session_id, &voice, tokens)
            .map(tauri::ipc::Response::new)
    })
    .await
    .map_err(fail)?
}

#[tauri::command(rename_all = "camelCase")]
pub async fn stop_tts(app: AppHandle, session_id: String) -> Result<(), String> {
    app.state::<AppState>().speech.cancel(&session_id)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().speech.release_if_idle())
        .await
        .map_err(fail)?
}
