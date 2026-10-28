# Reels Assembly — SYN-AI-006

An accepted `REEL_ASSEMBLED` MP4 can be selected as the private source for the separate [YTP-001–009 YouTube upload workflow](youtube-video-publishing.md). Assembly itself never uploads or publishes the Reel.

An owner assembles existing media for one saved draft into a private 1080×1920
MP4. This is local FFmpeg processing, not AI generation or publishing. Original
assets and draft text stay unchanged. One active render per owner is allowed.

| Behavior | Rule, acceptance and test subject |
|---|---|
| REEL-001 — Media selection | Select 1–10 images or H.264 MP4 clips from the draft's brand only; unknown and foreign IDs yield the same 404. Test mixed selection and isolation. |
| REEL-002 — Scene ordering and timing | Array order is render order. Images last 1–10 seconds; videos use an explicit start and 1–15 second segment within their probed duration. Total is at most 60 seconds. Test order, trims and invalid sums. |
| REEL-003 — Image/video composition | Images are contained with dark padding; videos are center-cropped without stretching. Each scene is normalized to 1080×1920, 30 fps, H.264/yuv420p. Test image-only, video-only and mixed output with ffprobe. |
| REEL-004 — Narration audio | One same-brand MP3 is optional. Source clip audio is always muted. Narration is padded with silence when short and trimmed when long; it never changes scene duration. Test AAC track and silence/trim rule. |
| REEL-005 — Text overlays | One short overlay up to 120 characters per scene, top/center/bottom. Server wraps and renders escaped UTF-8 text to an image layer with safe margins; FFmpeg receives no user filter expressions. Test Turkish characters and invalid control text. |
| REEL-006 — MP4 rendering | A PostgreSQL job moves QUEUED→RUNNING→SUCCEEDED/FAILED. The local API host claims one job at a time; no Redis/AI provider. FFmpeg has one thread, a process timeout and 20 MiB output bound. Test actual render, failure and restart recovery. |
| REEL-007 — Preview, Save and Attach | Successful output is private for one hour, then expires unless saved. Save creates `REEL_ASSEMBLED` MediaAsset without a second file copy; existing ContentMedia attaches it. Test byte integrity, expiry and attachment. |
| REEL-008 — Isolation, safety and lifecycle | Session/CSRF, server-derived ownership, opaque paths, bounded inputs, private work directory and cleanup. Duplicate request IDs and concurrent active renders are rejected. Test cross-brand access, immutability and no AI ledger changes. |

The first version has no transitions, source-audio mixing, subtitles, music,
keyframes, cloud rendering or publishing. RUNNING jobs left by an API crash are
marked FAILED on restart and can be explicitly retried with a new request ID;
the old job is never silently resubmitted. A crash between filesystem publication
and database commit can leave an orphan for operator maintenance.
