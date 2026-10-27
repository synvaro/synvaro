'use client';
/* eslint-disable @next/next/no-img-element -- authenticated same-origin private media */
import { useEffect, useState } from 'react';
import { ModelOptions, useModelCatalog } from './model-catalog';
interface Prefs {
  enabled: boolean;
  model: string;
  maxOutputTokens: number;
  monthlyBudgetUsd: number | null;
  confirmPaid: boolean;
  imageEnabled: boolean;
  imageModel: string;
  imageSize: string;
  imageQuality: string;
  imageAspectRatio: string;
}
interface Settings {
  preferences: Prefs;
  image: {
    available: boolean;
    models: string[];
    sizes: string[];
    qualities: string[];
    aspectRatios: string[];
    costNotice: string;
  };
}
interface Result {
  id: string;
  status: string;
  model: string;
  imageSize: string;
  imageQuality: string;
  imageAspectRatio: string | null;
  sourceMediaAssetId: string | null;
  provider: string;
  previewAvailable: boolean;
  mediaAssetId: string | null;
  estimatedCostUsd: number | null;
  costUncertain: boolean;
  inputTokens: number | null;
  inputImageTokens: number | null;
  outputTokens: number | null;
}
async function json(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(path, {
    method,
    ...(body !== undefined
      ? {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      res.status >= 500
        ? 'Image service unavailable. The charge may be uncertain. Refresh the result before retrying; requests are never retried automatically.'
        : (data.message ?? 'Request failed'),
    );
  return data;
}
export function ImagePanel({
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
  const catalog = useModelCatalog('IMAGE_GENERATION');
  const editingCatalog = useModelCatalog('IMAGE_EDITING');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [instruction, setInstruction] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attached, setAttached] = useState(false);
  const [mode, setMode] = useState<'generate' | 'edit'>('generate');
  const [sources, setSources] = useState<
    {
      id: string;
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
    }[]
  >([]);
  const [sourceId, setSourceId] = useState('');
  useEffect(() => {
    let active = true;
    void json(`/api/brands/${brandId}/media`)
      .then((data) => {
        if (active)
          setSources(
            data.assets.filter(
              (item: { mimeType: string; sizeBytes: number }) =>
                ['image/jpeg', 'image/png', 'image/webp'].includes(
                  item.mimeType,
                ) && item.sizeBytes <= 10 * 1024 * 1024,
            ),
          );
      })
      .catch(() => {
        if (active) setError('Unable to load brand images for editing.');
      });
    return () => {
      active = false;
    };
  }, [brandId]);
  useEffect(() => {
    let active = true;
    const load = () =>
      void json('/api/ai/preferences')
        .then((s: Settings) => {
          if (active) {
            setSettings(s);
            setPrefs(s.preferences);
            setConfirming(false);
          }
        })
        .catch(() => {
          if (active) setError('Unable to load image preferences.');
        });
    load();
    void json(`/api/contents/${contentId}/image-generations/latest`)
      .then((r: { generation: Result | null }) => {
        if (active) setResult(r.generation);
      })
      .catch(() => {
        if (active) setError('Unable to recover the latest image result.');
      });
    window.addEventListener('ai-preferences-saved', load);
    return () => {
      active = false;
      window.removeEventListener('ai-preferences-saved', load);
    };
  }, [contentId]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    setConfirming(false);
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Unable to connect. Refresh the result before retrying.',
      );
    } finally {
      setBusy(false);
      window.dispatchEvent(new Event('ai-usage-changed'));
    }
  }
  const dirty =
    !!prefs &&
    !!settings &&
    [
      'imageEnabled',
      'imageModel',
      'imageSize',
      'imageQuality',
      'imageAspectRatio',
    ].some(
      (k) => prefs[k as keyof Prefs] !== settings.preferences[k as keyof Prefs],
    );
  const selectedModel = catalog.models.find(
    (m) => m.model === prefs?.imageModel,
  );
  const selectedSettings =
    selectedModel?.implemented &&
    selectedModel.capability === 'IMAGE_GENERATION'
      ? selectedModel.settings
      : null;
  const googleSelected = selectedModel?.provider === 'google';
  return (
    <section className="brand-form-card ai-panel" aria-labelledby="image-title">
      <h2 id="image-title">Generate or edit image</h2>
      <p>
        Brand: <strong>{brandName}</strong>. Uses the saved draft and Brand
        Profile. Unsaved text stays untouched.
      </p>
      <p>
        Generated images are conceptual. AI editing may alter packaging, labels,
        appearance, quantity or product identity. Compare the source and result
        carefully before using a product image.
      </p>
      {catalog.message && <p role="status">{catalog.message}</p>}
      {catalog.models
        .filter((m) => m.unavailableReason)
        .map((m) => (
          <p key={m.model}>
            {m.model}: {m.unavailableReason}
          </p>
        ))}
      <fieldset disabled={busy || disabled}>
        {settings && prefs && (
          <>
            <details>
              <summary>Image generation preferences</summary>
              <label>
                <input
                  type="checkbox"
                  checked={prefs.imageEnabled}
                  onChange={(e) => {
                    setPrefs({ ...prefs, imageEnabled: e.target.checked });
                    setConfirming(false);
                  }}
                />{' '}
                Enable AI image generation
              </label>
              <label htmlFor="image-model">Image model</label>
              <select
                id="image-model"
                value={prefs.imageModel}
                onChange={(e) => {
                  const model = catalog.models.find(
                    (m) => m.model === e.target.value,
                  );
                  if (
                    model?.implemented &&
                    model.capability === 'IMAGE_GENERATION'
                  )
                    setPrefs({
                      ...prefs,
                      imageModel: e.target.value,
                      imageSize: model.settings.sizes[0]!,
                      imageQuality: model.settings.qualities[0]!,
                      imageAspectRatio:
                        model.settings.aspectRatios?.[0] ?? '1:1',
                    });
                  setMode('generate');
                  setSourceId('');
                  setConfirming(false);
                }}
              >
                <ModelOptions models={catalog.models} />
              </select>
              <label htmlFor="image-size">Image dimensions</label>
              <select
                id="image-size"
                value={prefs.imageSize}
                onChange={(e) => {
                  setPrefs({ ...prefs, imageSize: e.target.value });
                  setConfirming(false);
                }}
              >
                {selectedSettings?.sizes.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <label htmlFor="image-quality">Image quality</label>
              <select
                id="image-quality"
                value={prefs.imageQuality}
                onChange={(e) => {
                  setPrefs({ ...prefs, imageQuality: e.target.value });
                  setConfirming(false);
                }}
              >
                {selectedSettings?.qualities.map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </select>
              {googleSelected && (
                <>
                  <label htmlFor="image-aspect">Aspect ratio</label>
                  <select
                    id="image-aspect"
                    value={prefs.imageAspectRatio}
                    onChange={(e) => {
                      setPrefs({ ...prefs, imageAspectRatio: e.target.value });
                      setConfirming(false);
                    }}
                  >
                    {selectedSettings?.aspectRatios?.map((ratio) => (
                      <option key={ratio}>{ratio}</option>
                    ))}
                  </select>
                </>
              )}
              <p>
                Paid confirmation is always required for images. Monthly
                spending preference is shared with AI text generation and
                managed in AI preferences above.
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={!dirty}
                onClick={() =>
                  void action(async () => {
                    const current: Settings = await json('/api/ai/preferences');
                    const updated: Settings = await json(
                      '/api/ai/preferences',
                      'PUT',
                      {
                        ...current.preferences,
                        imageEnabled: prefs.imageEnabled,
                        imageModel: prefs.imageModel,
                        imageSize: prefs.imageSize,
                        imageQuality: prefs.imageQuality,
                        imageAspectRatio: prefs.imageAspectRatio,
                      },
                    );
                    setSettings(updated);
                    setPrefs(updated.preferences);
                    setNotice('Image preferences saved.');
                    window.dispatchEvent(new Event('ai-preferences-saved'));
                  })
                }
              >
                Save image preferences
              </button>
            </details>
            <p>
              {settings.preferences.imageModel} ·{' '}
              {settings.preferences.imageSize} ·{' '}
              {settings.preferences.imageQuality} · PNG · Images{' '}
              {googleSelected
                ? `${settings.preferences.imageAspectRatio} · `
                : ''}
              {settings.preferences.imageEnabled ? 'enabled' : 'disabled'}
            </p>
            <p>{settings.image.costNotice}</p>
            {settings.preferences.monthlyBudgetUsd !== null && (
              <p role="status">
                Selected shared monthly limit: $
                {settings.preferences.monthlyBudgetUsd.toFixed(2)}. Image
                generation is blocked because a reliable cost reservation is
                unavailable. Your budget has not been changed.
              </p>
            )}
            {!settings.image.available && (
              <p role="status">
                Image generation is unavailable. Server API key, private storage
                and current pricing configuration are required.
              </p>
            )}
            {googleSelected && (
              <div
                className="form-actions"
                role="group"
                aria-label="Image action"
              >
                <button
                  type="button"
                  className={
                    mode === 'generate' ? 'button' : 'secondary-button'
                  }
                  onClick={() => {
                    setMode('generate');
                    setConfirming(false);
                  }}
                >
                  Generate new
                </button>
                <button
                  type="button"
                  className={mode === 'edit' ? 'button' : 'secondary-button'}
                  disabled={
                    !editingCatalog.models.some((m) => m.status === 'AVAILABLE')
                  }
                  onClick={() => {
                    setMode('edit');
                    setConfirming(false);
                  }}
                >
                  Edit existing
                </button>
              </div>
            )}
            {mode === 'edit' && googleSelected && (
              <>
                <label htmlFor="edit-source">
                  Source image from {brandName}
                </label>
                <select
                  id="edit-source"
                  value={sourceId}
                  onChange={(e) => {
                    setSourceId(e.target.value);
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
                    No eligible images in this brand. Upload a JPEG, PNG or WebP
                    under 10 MiB to Media Library first.
                  </p>
                )}
              </>
            )}
            <label htmlFor="image-instruction">Visual instruction</label>
            <textarea
              id="image-instruction"
              rows={3}
              maxLength={1000}
              value={instruction}
              onChange={(e) => {
                setInstruction(e.target.value);
                setConfirming(false);
              }}
              placeholder={
                mode === 'edit'
                  ? 'Describe the specific change, such as improving lighting while keeping the product intact.'
                  : 'Describe a conceptual illustration or atmospheric visual.'
              }
            />
            {dirty && <p>Save image preferences before generating.</p>}
            <button
              type="button"
              className="button"
              disabled={
                !instruction.trim() ||
                (mode === 'edit' && !sourceId) ||
                dirty ||
                !catalog.models.some(
                  (m) =>
                    m.model === settings.preferences.imageModel &&
                    m.status === 'AVAILABLE',
                ) ||
                !settings.image.available ||
                !settings.preferences.imageEnabled ||
                settings.preferences.monthlyBudgetUsd !== null ||
                result?.previewAvailable ||
                result?.status === 'RUNNING'
              }
              onClick={() => setConfirming(true)}
            >
              {mode === 'edit'
                ? 'Edit image preview'
                : 'Generate image preview'}
            </button>
            {confirming && (
              <div
                className="discard-prompt"
                role="alertdialog"
                aria-label="Confirm paid image generation"
              >
                <p>
                  This sends saved brand context to{' '}
                  {catalog.models.find(
                    (m) => m.model === settings.preferences.imageModel,
                  )?.provider ?? 'the configured provider'}
                  . Cost cannot be bounded reliably. No spending limit is
                  selected. Generate one {settings.preferences.imageSize}{' '}
                  {settings.preferences.imageQuality} image with{' '}
                  {settings.preferences.imageModel}?
                  {mode === 'edit' &&
                    ' The original image will remain unchanged.'}
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
                            `/api/contents/${contentId}/${mode === 'edit' ? 'image-edits' : 'image-generations'}`,
                            'POST',
                            {
                              requestId: crypto.randomUUID(),
                              instruction,
                              confirmed: true,
                              ...(mode === 'edit'
                                ? { sourceMediaAssetId: sourceId }
                                : {}),
                            },
                          ),
                        );
                        setNotice(
                          'Preview ready. Nothing was saved or attached.',
                        );
                      })
                    }
                  >
                    Confirm paid image generation
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setConfirming(false)}
                  >
                    Cancel image generation
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {result && (
          <section aria-label="Generated image result">
            <h3>
              {result.sourceMediaAssetId
                ? 'AI-edited image'
                : 'AI-generated image'}{' '}
              — review before saving
            </h3>
            {result.sourceMediaAssetId && (
              <div className="image-compare">
                <div>
                  <p>Original — unchanged</p>
                  <img
                    className="generated-image-preview"
                    src={`/api/media/${result.sourceMediaAssetId}/file`}
                    alt="Original source image"
                  />
                </div>
                <div>
                  <p>Edited preview</p>
                  {(result.previewAvailable || result.mediaAssetId) && (
                    <img
                      className="generated-image-preview"
                      src={
                        result.mediaAssetId
                          ? `/api/media/${result.mediaAssetId}/file`
                          : `/api/image-generations/${result.id}/file`
                      }
                      alt="AI-edited result for visual review"
                    />
                  )}
                </div>
              </div>
            )}
            {!result.sourceMediaAssetId &&
              (result.previewAvailable || result.mediaAssetId) && (
                <img
                  className="generated-image-preview"
                  src={
                    result.mediaAssetId
                      ? `/api/media/${result.mediaAssetId}/file`
                      : `/api/image-generations/${result.id}/file`
                  }
                  alt="AI-generated conceptual visual; not authentic product photography"
                />
              )}
            <p>
              {result.provider} · {result.model} · {result.imageSize} ·{' '}
              {result.imageQuality} · {result.status}
            </p>
            <p>
              {result.inputTokens === null
                ? 'Usage unavailable'
                : `${result.inputTokens} text input / ${result.inputImageTokens ?? 0} image input / ${result.outputTokens} output tokens`}{' '}
              ·{' '}
              {result.estimatedCostUsd === null
                ? 'Estimated cost unavailable'
                : `Estimated cost $${result.estimatedCostUsd.toFixed(6)} (not billed cost)`}
              .{' '}
              {result.costUncertain &&
                'Charge uncertain; operator reconciliation required before budgeted generation.'}
            </p>
            {!result.previewAvailable && !result.mediaAssetId && (
              <p>
                No preview available: it may be active, failed, discarded or
                expired. Previews expire after one hour.
              </p>
            )}
            <div className="form-actions">
              {result.previewAvailable && (
                <>
                  <button
                    type="button"
                    className="button"
                    onClick={() =>
                      void action(async () => {
                        await json(
                          `/api/image-generations/${result.id}/accept`,
                          'POST',
                          {},
                        );
                        setResult(
                          await json(`/api/image-generations/${result.id}`),
                        );
                        setNotice(
                          'Saved to this brand’s private Media Library.',
                        );
                      })
                    }
                  >
                    Save image to Media Library
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      void action(async () => {
                        setResult(
                          await json(
                            `/api/image-generations/${result.id}`,
                            'DELETE',
                            {},
                          ),
                        );
                        setNotice('Preview discarded. Usage record retained.');
                      })
                    }
                  >
                    Discard image preview
                  </button>
                </>
              )}
              {result.mediaAssetId && (
                <button
                  type="button"
                  className="button"
                  disabled={attached}
                  onClick={() =>
                    void action(async () => {
                      await json(`/api/contents/${contentId}/media`, 'POST', {
                        mediaAssetId: result.mediaAssetId,
                      });
                      setAttached(true);
                      onAttached();
                      setNotice(
                        'Image attached. Draft text remains unchanged.',
                      );
                    })
                  }
                >
                  {attached ? 'Image attached' : 'Attach saved image to draft'}
                </button>
              )}
            </div>
          </section>
        )}
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            void action(async () => {
              setResult(
                (
                  await json(
                    `/api/contents/${contentId}/image-generations/latest`,
                  )
                ).generation,
              );
              setNotice('Latest result refreshed without generating.');
            })
          }
        >
          Refresh image result
        </button>
      </fieldset>
      <p role="status" className="form-notice">
        {busy
          ? 'Working… Generation can take up to two minutes. No automatic retries.'
          : notice}
      </p>
      <p role="alert" className="form-error">
        {error}
      </p>
    </section>
  );
}
