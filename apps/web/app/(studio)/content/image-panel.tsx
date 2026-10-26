'use client';
/* eslint-disable @next/next/no-img-element -- authenticated same-origin private media */
import { useEffect, useState } from 'react';
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
}
interface Settings {
  preferences: Prefs;
  image: {
    available: boolean;
    models: string[];
    sizes: string[];
    qualities: string[];
    costNotice: string;
  };
}
interface Result {
  id: string;
  status: string;
  model: string;
  imageSize: string;
  imageQuality: string;
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
  brandName,
  disabled,
  onAttached,
}: {
  contentId: string;
  brandName: string;
  disabled: boolean;
  onAttached: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [instruction, setInstruction] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attached, setAttached] = useState(false);
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
    ['imageEnabled', 'imageModel', 'imageSize', 'imageQuality'].some(
      (k) => prefs[k as keyof Prefs] !== settings.preferences[k as keyof Prefs],
    );
  return (
    <section className="brand-form-card ai-panel" aria-labelledby="image-title">
      <h2 id="image-title">Generate Image</h2>
      <p>
        Brand: <strong>{brandName}</strong>. Uses the saved draft and Brand
        Profile. Unsaved text stays untouched.
      </p>
      <p>
        AI-generated conceptual imagery, not authentic product photography.
        Review carefully; do not present invented products, packaging or claims
        as real.
      </p>
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
                onChange={(e) =>
                  setPrefs({ ...prefs, imageModel: e.target.value })
                }
              >
                {settings.image.models.map((m) => (
                  <option key={m}>{m}</option>
                ))}
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
                {settings.image.sizes.map((s) => (
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
                {settings.image.qualities.map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </select>
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
              placeholder="Describe a conceptual illustration or atmospheric visual."
            />
            {dirty && <p>Save image preferences before generating.</p>}
            <button
              type="button"
              className="button"
              disabled={
                !instruction.trim() ||
                dirty ||
                !settings.image.available ||
                !settings.preferences.imageEnabled ||
                settings.preferences.monthlyBudgetUsd !== null ||
                result?.previewAvailable ||
                result?.status === 'RUNNING'
              }
              onClick={() => setConfirming(true)}
            >
              Generate image preview
            </button>
            {confirming && (
              <div
                className="discard-prompt"
                role="alertdialog"
                aria-label="Confirm paid image generation"
              >
                <p>
                  This sends saved brand context to OpenAI. Cost cannot be
                  bounded reliably. No spending limit is selected. Generate one{' '}
                  {settings.preferences.imageSize}{' '}
                  {settings.preferences.imageQuality} image with{' '}
                  {settings.preferences.imageModel}?
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
                            `/api/contents/${contentId}/image-generations`,
                            'POST',
                            {
                              requestId: crypto.randomUUID(),
                              instruction,
                              confirmed: true,
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
            <h3>AI-generated image — review before saving</h3>
            {(result.previewAvailable || result.mediaAssetId) && (
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
              {result.model} · {result.imageSize} · {result.imageQuality} ·{' '}
              {result.status}
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
