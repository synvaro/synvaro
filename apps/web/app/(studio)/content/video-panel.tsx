'use client';
/* eslint-disable @next/next/no-img-element -- authenticated same-origin private media */
import { useEffect, useState } from 'react';
import { useModelCatalog } from './model-catalog';

interface Preferences {
  videoEnabled: boolean;
  monthlyBudgetUsd: number | null;
  [key: string]: unknown;
}
interface Result {
  id: string;
  status: string;
  provider: string;
  model: string;
  videoDuration: string;
  videoAspectRatio: string;
  videoResolution: string;
  videoHasAudio: boolean | null;
  sourceMediaAssetId: string | null;
  previewAvailable: boolean;
  mediaAssetId: string | null;
  estimatedCostUsd: number | null;
  costUncertain: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  outputVideoTokens: number | null;
  errorCode: string | null;
}
interface Source {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
}
async function json(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      response.status >= 500
        ? 'Video service unavailable. The charge may be uncertain. Refresh status before any new request.'
        : (data.message ?? 'Request failed'),
    );
  return data;
}

export function VideoPanel({
  contentId,
  brandId,
  brandName,
  disabled,
  onAttached,
}: {
  contentId: string;
  brandId: string;
  brandName: string;
  disabled: boolean;
  onAttached: () => void;
}) {
  const generation = useModelCatalog('VIDEO_GENERATION');
  const animation = useModelCatalog('IMAGE_TO_VIDEO');
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [model, setModel] = useState('');
  const [duration, setDuration] = useState('');
  const [aspectRatio, setAspectRatio] = useState('');
  const [resolution, setResolution] = useState('');
  const [instruction, setInstruction] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attached, setAttached] = useState(false);
  const models = mode === 'text' ? generation.models : animation.models;
  const effectiveModel =
    model || models.find((item) => item.status === 'AVAILABLE')?.model || '';
  const selected = models.find((item) => item.model === effectiveModel);
  const settings =
    selected?.implemented &&
    (selected.capability === 'VIDEO_GENERATION' ||
      selected.capability === 'IMAGE_TO_VIDEO')
      ? selected.settings
      : null;
  const effectiveDuration = duration || settings?.durations[0] || '';
  const effectiveAspectRatio = aspectRatio || settings?.aspectRatios[0] || '';
  const effectiveResolution = resolution || settings?.resolutions[0] || '';
  useEffect(() => {
    let active = true;
    void Promise.all([
      json('/api/ai/preferences'),
      json(`/api/contents/${contentId}/video-generations/latest`),
      json(`/api/brands/${brandId}/media`),
      json(`/api/contents/${contentId}/media`),
    ])
      .then(([p, latest, media, attachments]) => {
        if (!active) return;
        setPrefs(p.preferences);
        setResult(latest.generation);
        setAttached(
          !!latest.generation?.mediaAssetId &&
            attachments.attachments.some(
              (item: { mediaAssetId: string }) =>
                item.mediaAssetId === latest.generation.mediaAssetId,
            ),
        );
        setSources(
          media.assets.filter(
            (asset: Source) =>
              ['image/jpeg', 'image/png', 'image/webp'].includes(
                asset.mimeType,
              ) && asset.sizeBytes <= 10 * 1024 * 1024,
          ),
        );
      })
      .catch(() => {
        if (active) setError('Unable to load video settings or saved status.');
      });
    return () => {
      active = false;
    };
  }, [contentId, brandId]);
  const resultId = result?.id;
  const resultStatus = result?.status;
  useEffect(() => {
    if (!resultId || !['PENDING', 'RUNNING'].includes(resultStatus ?? ''))
      return;
    let attempts = 0;
    const timer = setInterval(() => {
      if (++attempts > 24) {
        clearInterval(timer);
        return;
      }
      void json(`/api/video-generations/${resultId}`)
        .then((next: Result) => {
          setResult(next);
          if (!['PENDING', 'RUNNING'].includes(next.status))
            clearInterval(timer);
        })
        .catch(() => {
          clearInterval(timer);
          setError(
            'Status unavailable. Refresh status; generation was not resubmitted.',
          );
        });
    }, 10_000);
    return () => clearInterval(timer);
  }, [resultId, resultStatus]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    setConfirming(false);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
      window.dispatchEvent(new Event('ai-usage-changed'));
    }
  }
  return (
    <section className="brand-form-card ai-panel" aria-labelledby="video-title">
      <h2 id="video-title">Generate video</h2>
      <p>
        Brand: <strong>{brandName}</strong>. Uses the saved draft and Brand
        Profile. Unsaved text and source media remain unchanged.
      </p>
      <p>
        AI-generated conceptual footage requires review. No automatic save,
        attachment or publication.
      </p>
      {generation.message && <p role="status">{generation.message}</p>}
      {prefs && (
        <label>
          <input
            type="checkbox"
            checked={prefs.videoEnabled}
            disabled={busy || disabled}
            onChange={(event) => {
              const enabled = event.target.checked;
              void action(async () => {
                const current = await json('/api/ai/preferences');
                const updated = await json('/api/ai/preferences', 'PUT', {
                  ...current.preferences,
                  videoEnabled: enabled,
                });
                setPrefs(updated.preferences);
                setNotice('Video preference saved.');
              });
            }}
          />{' '}
          Enable AI video generation
        </label>
      )}
      {prefs?.monthlyBudgetUsd !== null && prefs && (
        <p role="status">
          Selected shared monthly budget: ${prefs.monthlyBudgetUsd.toFixed(2)}.
          Video generation is blocked because a reliable pre-request cost bound
          is unavailable. Your budget has not changed.
        </p>
      )}
      <fieldset disabled={busy || disabled}>
        <div className="form-actions" role="group" aria-label="Video mode">
          <button
            type="button"
            className={mode === 'text' ? 'button' : 'secondary-button'}
            onClick={() => {
              setMode('text');
              setModel('');
              setConfirming(false);
            }}
          >
            Text to video
          </button>
          <button
            type="button"
            className={mode === 'image' ? 'button' : 'secondary-button'}
            onClick={() => {
              setMode('image');
              setModel('');
              setConfirming(false);
            }}
          >
            Animate image
          </button>
        </div>
        <label htmlFor="video-model">Video model</label>
        <select
          id="video-model"
          value={effectiveModel}
          onChange={(event) => {
            setModel(event.target.value);
            setConfirming(false);
          }}
        >
          <option value="">Select a model</option>
          {models.map((item) => (
            <option
              key={item.model}
              value={item.model}
              disabled={item.status !== 'AVAILABLE'}
            >
              {item.provider} · {item.model}
              {item.status !== 'AVAILABLE' ? ' — not configured' : ''}
            </option>
          ))}
        </select>
        {models
          .filter((item) => item.unavailableReason)
          .map((item) => (
            <p key={item.model} role="status">
              {item.unavailableReason}
            </p>
          ))}
        {mode === 'image' && (
          <>
            <label htmlFor="video-source">Source image from {brandName}</label>
            <select
              id="video-source"
              value={sourceId}
              onChange={(event) => {
                setSourceId(event.target.value);
                setConfirming(false);
              }}
            >
              <option value="">Select an image</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.originalFilename}
                </option>
              ))}
            </select>
            {!sources.length && (
              <p>
                No eligible image in this brand. Upload a JPEG, PNG or WebP
                under 10 MiB first.
              </p>
            )}
          </>
        )}
        <label htmlFor="video-duration">Duration</label>
        <select
          id="video-duration"
          value={effectiveDuration}
          onChange={(e) => {
            setDuration(e.target.value);
            setConfirming(false);
          }}
        >
          {settings?.durations.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <label htmlFor="video-aspect">Aspect ratio</label>
        <select
          id="video-aspect"
          value={effectiveAspectRatio}
          onChange={(e) => {
            setAspectRatio(e.target.value);
            setConfirming(false);
          }}
        >
          {settings?.aspectRatios.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <label htmlFor="video-resolution">Resolution</label>
        <select
          id="video-resolution"
          value={effectiveResolution}
          onChange={(e) => {
            setResolution(e.target.value);
            setConfirming(false);
          }}
        >
          {settings?.resolutions.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <label htmlFor="video-instruction">Scene and motion instruction</label>
        <textarea
          id="video-instruction"
          rows={3}
          maxLength={1000}
          value={instruction}
          onChange={(e) => {
            setInstruction(e.target.value);
            setConfirming(false);
          }}
          placeholder="Describe a short conceptual scene and camera movement."
        />
        <p>
          Estimated price is usage-dependent; no reliable reservation is
          available. One confirmed request may incur charges.
        </p>
        <button
          type="button"
          className="button"
          disabled={
            !prefs?.videoEnabled ||
            prefs.monthlyBudgetUsd !== null ||
            selected?.status !== 'AVAILABLE' ||
            !instruction.trim() ||
            (mode === 'image' && !sourceId) ||
            result?.previewAvailable ||
            ['PENDING', 'RUNNING'].includes(result?.status ?? '')
          }
          onClick={() => setConfirming(true)}
        >
          Generate video preview
        </button>
        {confirming && (
          <div
            className="discard-prompt"
            role="alertdialog"
            aria-label="Confirm paid video generation"
          >
            <p>
              Send saved brand context
              {mode === 'image' ? ' and the selected brand image' : ''} to
              Google {effectiveModel}? One {effectiveDuration}{' '}
              {effectiveAspectRatio} {effectiveResolution} request may incur
              charges. No monthly spending limit is selected.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="button"
                onClick={() =>
                  void action(async () => {
                    setAttached(false);
                    setResult(
                      await json(
                        `/api/contents/${contentId}/video-generations`,
                        'POST',
                        {
                          requestId: crypto.randomUUID(),
                          instruction,
                          model: effectiveModel,
                          duration: effectiveDuration,
                          aspectRatio: effectiveAspectRatio,
                          resolution: effectiveResolution,
                          confirmed: true,
                          ...(mode === 'image'
                            ? { sourceMediaAssetId: sourceId }
                            : {}),
                        },
                      ),
                    );
                    setNotice(
                      'Generation started. Status can be resumed after refresh.',
                    );
                  })
                }
              >
                Confirm paid generation
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </fieldset>
      {result && (
        <section aria-label="Generated video result">
          <h3>
            {result.sourceMediaAssetId
              ? 'AI-animated image'
              : 'AI-generated video'}{' '}
            — review before saving
          </h3>
          {result.sourceMediaAssetId && (
            <div>
              <p>Source image — unchanged</p>
              <img
                className="generated-image-preview"
                src={`/api/media/${result.sourceMediaAssetId}/file`}
                alt="Unchanged source image"
              />
            </div>
          )}
          {(result.previewAvailable || result.mediaAssetId) && (
            <video
              controls
              playsInline
              className="generated-video-preview"
              src={
                result.mediaAssetId
                  ? `/api/media/${result.mediaAssetId}/file`
                  : `/api/video-generations/${result.id}/file`
              }
            />
          )}
          <p>
            {result.provider} · {result.model} · {result.videoDuration} ·{' '}
            {result.videoAspectRatio} · {result.videoResolution} ·{' '}
            {result.status} · Audio track:{' '}
            {result.videoHasAudio === null
              ? 'not yet known'
              : result.videoHasAudio
                ? 'yes'
                : 'no'}
          </p>
          <p>
            {result.inputTokens === null
              ? 'Usage unavailable'
              : `${result.inputTokens} input / ${result.outputTokens} output (${result.outputVideoTokens} video) tokens`}{' '}
            ·{' '}
            {result.estimatedCostUsd === null
              ? 'Estimated cost unavailable'
              : `Estimated cost $${result.estimatedCostUsd.toFixed(6)} (not an invoice)`}
            {result.costUncertain ? ' · Charge uncertain' : ''}
          </p>
          {result.errorCode && (
            <p role="status">
              Operation ended: {result.errorCode}. Charges may be uncertain.
            </p>
          )}
          <div className="form-actions">
            {result.previewAvailable && (
              <>
                <button
                  type="button"
                  className="button"
                  disabled={busy || disabled}
                  onClick={() =>
                    void action(async () => {
                      await json(
                        `/api/video-generations/${result.id}/accept`,
                        'POST',
                        {},
                      );
                      setResult(
                        await json(`/api/video-generations/${result.id}`),
                      );
                      setNotice(
                        'Video saved to this brand’s private Media Library.',
                      );
                    })
                  }
                >
                  Save to Media Library
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || disabled}
                  onClick={() =>
                    void action(async () => {
                      setResult(
                        await json(
                          `/api/video-generations/${result.id}`,
                          'DELETE',
                          {},
                        ),
                      );
                      setNotice('Preview discarded; usage record retained.');
                    })
                  }
                >
                  Discard preview
                </button>
              </>
            )}
            {result.mediaAssetId && (
              <button
                type="button"
                className="button"
                disabled={busy || disabled || attached}
                onClick={() =>
                  void action(async () => {
                    await json(`/api/contents/${contentId}/media`, 'POST', {
                      mediaAssetId: result.mediaAssetId,
                    });
                    setAttached(true);
                    onAttached();
                    setNotice('Video attached without changing draft text.');
                  })
                }
              >
                {attached ? 'Video attached' : 'Attach saved video to draft'}
              </button>
            )}
          </div>
        </section>
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={busy}
        onClick={() =>
          void action(async () => {
            setResult(
              (
                await json(
                  `/api/contents/${contentId}/video-generations/latest`,
                )
              ).generation,
            );
            setNotice('Latest status refreshed without a new paid request.');
          })
        }
      >
        Refresh video status
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
