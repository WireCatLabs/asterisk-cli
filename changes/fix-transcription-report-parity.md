### Changed — may break callers

- **`meetings transcribe` answers the same report as the other phone CLIs (beeline, b24).** The audio time is
  `audio_ms`, in milliseconds (was `audio_seconds`). Each failed call has its `ref`. A call with no recording is listed
  under `failed` with the reason `recording.missing`, and `without_recording` is gone.
