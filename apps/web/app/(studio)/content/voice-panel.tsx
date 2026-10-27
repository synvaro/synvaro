'use client';
import { useEffect, useRef, useState } from 'react';
import { useModelCatalog } from './model-catalog';

type Voice = { id: string; name: string; languages: string[] };
type Result = {
  id: string;
  status: string;
  voiceId: string;
  model: string;
  previewAvailable: boolean;
  mediaAssetId: string | null;
  narrationCharacters: number | null;
  providerCharacterCost: number | null;
  costUncertain: boolean;
  errorCode: string | null;
};
type Prefs = Record<string, unknown> & {
  speechEnabled: boolean;
  monthlyBudgetUsd: number | null;
};
async function json(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, {
    method,
    cache: 'no-store',
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
        ? 'Voice service unavailable. A provider charge may be uncertain; refresh before another request.'
        : (data.message ?? 'Request failed'),
    );
  return data;
}
export function VoicePanel({
  contentId,
  brandName,
  savedBody,
  disabled,
  onAttached,
}: {
  contentId: string;
  brandName: string;
  savedBody: string;
  disabled: boolean;
  onAttached: () => void;
}) {
  const catalog = useModelCatalog('SPEECH_GENERATION');
  const model = catalog.models[0];
  const maxCharacters =
    model?.implemented && model.capability === 'SPEECH_GENERATION'
      ? model.settings.maxCharacters
      : 2000;
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [text, setText] = useState(savedBody);
  const previousSaved = useRef(savedBody);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setText((current) =>
      current === previousSaved.current ? savedBody : current,
    );
    previousSaved.current = savedBody;
  }, [savedBody]);
  useEffect(() => {
    let active = true;
    void json('/api/ai/preferences')
      .then((data) => {
        if (active) setPrefs(data.preferences);
      })
      .catch(() => {
        if (active) setError('Unable to load AI preferences.');
      });
    void json('/api/ai/voices')
      .then((data: { voices: Voice[] }) => {
        if (active) {
          setVoices(data.voices);
          setVoiceId(data.voices[0]?.id ?? '');
        }
      })
      .catch(() => {
        if (active)
          setError(
            'Voice list unavailable. Check server configuration or configured premade voice.',
          );
      });
    void json(`/api/contents/${contentId}/speech-generations/latest`)
      .then((data: { generation: Result | null }) => {
        if (active) setResult(data.generation);
      })
      .catch(() => {
        if (active) setError('Unable to recover voice preview.');
      });
    return () => {
      active = false;
    };
  }, [contentId]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    setConfirming(false);
    try {
      await work();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Unable to complete voice action.',
      );
    } finally {
      setBusy(false);
      window.dispatchEvent(new Event('ai-usage-changed'));
    }
  }
  const canGenerate =
    model?.status === 'AVAILABLE' &&
    prefs?.speechEnabled &&
    prefs.monthlyBudgetUsd === null &&
    !!voiceId &&
    !!text.trim() &&
    [...text].length <= maxCharacters &&
    !result?.previewAvailable &&
    result?.status !== 'RUNNING';
  return (
    <section className="brand-form-card ai-panel" aria-labelledby="voice-title">
      <h2 id="voice-title">Generate Voice</h2>
      <p>
        Brand: <strong>{brandName}</strong>. Start from the saved draft body,
        then edit narration independently. Generating audio never changes the
        draft.
      </p>
      <p>
        Use only a premade voice. Review pronunciation and usage rights before
        publishing elsewhere.
      </p>
      {catalog.message && <p role="status">{catalog.message}</p>}
      <p>
        {model
          ? `${model.provider} · ${model.model}`
          : 'No speech model available'}
      </p>
      {model?.unavailableReason && (
        <p role="status">{model.unavailableReason}</p>
      )}
      <fieldset disabled={disabled || busy}>
        <label>
          <input
            type="checkbox"
            checked={prefs?.speechEnabled ?? false}
            disabled={!prefs}
            onChange={(event) => {
              if (!prefs) return;
              const next = event.target.checked;
              void action(async () => {
                const updated = await json('/api/ai/preferences', 'PUT', {
                  ...prefs,
                  speechEnabled: next,
                });
                setPrefs(updated.preferences);
                setNotice('Voice preference saved.');
              });
            }}
          />{' '}
          Enable voice generation
        </label>
        <label htmlFor="voice-choice">Available premade voice</label>
        <select
          id="voice-choice"
          value={voiceId}
          onChange={(event) => {
            setVoiceId(event.target.value);
            setConfirming(false);
          }}
        >
          <option value="">Select a voice</option>
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name}
              {voice.languages.length ? ` · ${voice.languages.join(', ')}` : ''}
            </option>
          ))}
        </select>
        {!voices.length && (
          <p>No usable premade voices returned for this server account.</p>
        )}
        <label htmlFor="voice-text">Narration text</label>
        <textarea
          id="voice-text"
          rows={5}
          maxLength={maxCharacters}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setConfirming(false);
          }}
        />
        <p>
          {[...text].length} / {maxCharacters} characters. Estimated provider
          character/credit cost cannot be converted to a reliable USD amount
          before the call.
        </p>
        {prefs?.monthlyBudgetUsd !== null && prefs && (
          <p role="status">
            Selected shared monthly budget: ${prefs.monthlyBudgetUsd.toFixed(2)}
            . Voice generation is blocked; the budget was not changed.
          </p>
        )}
        <button
          type="button"
          className="button"
          disabled={!canGenerate}
          onClick={() => setConfirming(true)}
        >
          Generate voice preview
        </button>
        {confirming && (
          <div
            className="discard-prompt"
            role="alertdialog"
            aria-label="Confirm paid voice generation"
          >
            <p>
              Send this narration to ElevenLabs using {model?.model} and the
              selected voice? One request may consume account credits. USD cost
              cannot be bounded reliably; no spending limit is selected.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="button"
                onClick={() =>
                  void action(async () => {
                    const next = await json(
                      `/api/contents/${contentId}/speech-generations`,
                      'POST',
                      {
                        requestId: crypto.randomUUID(),
                        model: model!.model,
                        voiceId,
                        text,
                        confirmed: true,
                      },
                    );
                    setResult(next);
                    setNotice(
                      'Private preview ready. Draft text is unchanged.',
                    );
                  })
                }
              >
                Confirm paid voice generation
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
        {result && (
          <div>
            <p>
              Status: {result.status} · {result.model} ·{' '}
              {result.narrationCharacters ?? 'Unknown'} characters.
            </p>
            <p>
              Provider character cost:{' '}
              {result.providerCharacterCost ?? 'Unavailable'}; estimated USD:
              unavailable. This is not a provider invoice.
            </p>
            {result.previewAvailable && (
              <audio
                controls
                preload="metadata"
                src={`/api/speech-generations/${result.id}/file`}
                aria-label="Private voice preview"
              />
            )}
            {result.mediaAssetId && (
              <audio
                controls
                preload="metadata"
                src={`/api/media/${result.mediaAssetId}/file`}
                aria-label="Saved voice asset"
              />
            )}
            {result.previewAvailable && (
              <div className="form-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    void action(async () => {
                      const asset = await json(
                        `/api/speech-generations/${result.id}/accept`,
                        'POST',
                        {},
                      );
                      setResult({
                        ...result,
                        mediaAssetId: asset.id,
                        previewAvailable: false,
                      });
                      setNotice('Audio saved privately to Media Library.');
                    })
                  }
                >
                  Save to Media Library
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    void action(async () => {
                      setResult(
                        await json(
                          `/api/speech-generations/${result.id}`,
                          'DELETE',
                          {},
                        ),
                      );
                      setNotice('Preview discarded.');
                    })
                  }
                >
                  Discard preview
                </button>
              </div>
            )}
            {result.mediaAssetId && (
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void action(async () => {
                    await json(`/api/contents/${contentId}/media`, 'POST', {
                      mediaAssetId: result.mediaAssetId,
                    });
                    onAttached();
                    setNotice('Saved audio attached to this draft.');
                  })
                }
              >
                Attach saved audio to draft
              </button>
            )}
          </div>
        )}
      </fieldset>
      {busy && (
        <p role="status">
          Working… Keep this page open; requests are not retried automatically.
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
