'use client';
import { useEffect, useState } from 'react';
interface Preferences {
  enabled: boolean;
  model: string;
  maxOutputTokens: number;
  monthlyBudgetUsd: number | null;
  confirmPaid: boolean;
}
interface Settings {
  preferences: Preferences;
  available: boolean;
  unavailableReason: string | null;
  models: string[];
  usage: {
    month: string;
    chargedOrReservedUsd: number;
    requests: number;
    uncertainRequests: number;
    activeRequest: boolean;
  };
  budgetNotice: string;
}
interface Suggestion {
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  estimatedCostUsd: number | null;
  costUncertain: boolean;
}
export function AiPanel({
  contentId,
  disabled,
  onApply,
}: {
  contentId: string;
  disabled: boolean;
  onApply: (text: string) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [instruction, setInstruction] = useState('');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void fetch('/api/ai/preferences')
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data = (await response.json()) as Settings;
        if (active) {
          setSettings(data);
          setPrefs(data.preferences);
        }
      })
      .catch(() => {
        if (active)
          setError('Unable to load AI preferences. Refresh to try again.');
      });
    return () => {
      active = false;
    };
  }, []);
  async function savePreferences() {
    setBusy(true);
    setError('');
    setConfirming(false);
    try {
      const response = await fetch('/api/ai/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message ?? 'Unable to save preferences.');
      setSettings(data);
      setPrefs(data.preferences);
      setNotice('AI preferences saved.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to connect.');
    } finally {
      setBusy(false);
    }
  }
  async function generate(confirmed = false) {
    if (settings?.preferences.confirmPaid && !confirmed) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setBusy(true);
    setError('');
    setNotice('');
    setSuggestion(null);
    try {
      const response = await fetch(
        `/api/contents/${contentId}/ai-generations`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            instruction,
            confirmed,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          response.status >= 500
            ? 'Provider unavailable or timed out. No draft was changed. A paid attempt may retain its budget reservation; review usage before retrying.'
            : (data.message ?? 'Generation failed.'),
        );
      setSuggestion(data);
      setNotice('Suggestion ready. Your draft has not changed.');
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to connect. The outcome may be uncertain; review usage before retrying.',
      );
    } finally {
      setBusy(false);
      try {
        const response = await fetch('/api/ai/preferences');
        if (response.ok) setSettings(await response.json());
      } catch {
        /* Keep the last known usage, never auto-retry generation. */
      }
    }
  }
  const preferencesDirty =
    prefs &&
    settings &&
    JSON.stringify(prefs) !== JSON.stringify(settings.preferences);
  return (
    <section className="brand-form-card ai-panel" aria-labelledby="ai-title">
      <h2 id="ai-title">Generate with AI</h2>
      <p>
        Uses this draft’s saved text and Brand Profile. Unsaved edits are not
        sent. Media metadata only; images and videos are not analyzed.
      </p>
      <fieldset disabled={busy || disabled}>
        {prefs && settings && (
          <>
            <details>
              <summary>AI preferences</summary>
              <label>
                <input
                  type="checkbox"
                  checked={prefs.enabled}
                  onChange={(e) =>
                    setPrefs({ ...prefs, enabled: e.target.checked })
                  }
                />{' '}
                Enable AI generation
              </label>
              <label htmlFor="ai-model">Preferred model</label>
              <select
                id="ai-model"
                value={prefs.model}
                onChange={(e) => setPrefs({ ...prefs, model: e.target.value })}
              >
                {settings.models.map((model) => (
                  <option key={model}>{model}</option>
                ))}
              </select>
              <label htmlFor="ai-tokens">
                Maximum output tokens (128–2048)
              </label>
              <input
                id="ai-tokens"
                type="number"
                min={128}
                max={2048}
                value={prefs.maxOutputTokens}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    maxOutputTokens: Number(e.target.value),
                  })
                }
              />
              <label htmlFor="ai-budget">
                Optional monthly estimated spending limit (USD)
              </label>
              <input
                id="ai-budget"
                type="number"
                min={0}
                max={1000000}
                step="0.01"
                value={prefs.monthlyBudgetUsd ?? ''}
                placeholder="No budget selected"
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    monthlyBudgetUsd:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
              <label>
                <input
                  type="checkbox"
                  checked={prefs.confirmPaid}
                  onChange={(e) =>
                    setPrefs({ ...prefs, confirmPaid: e.target.checked })
                  }
                />{' '}
                Confirm before each paid generation
              </label>
              <p>{settings.budgetNotice}</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void savePreferences()}
                disabled={!preferencesDirty}
              >
                Save AI preferences
              </button>
            </details>
            <p>
              Model: {settings.preferences.model} · Up to{' '}
              {settings.preferences.maxOutputTokens} output tokens · AI{' '}
              {settings.preferences.enabled ? 'enabled' : 'disabled'} · Paid
              confirmation {settings.preferences.confirmPaid ? 'on' : 'off'}
            </p>
            <p>
              UTC {settings.usage.month}: estimated charges / reservations $
              {settings.usage.chargedOrReservedUsd.toFixed(6)}.{' '}
              {settings.preferences.monthlyBudgetUsd === null
                ? 'No spending limit selected.'
                : `Selected limit: $${settings.preferences.monthlyBudgetUsd.toFixed(2)}.`}
            </p>
            {settings.usage.uncertainRequests > 0 && (
              <p role="status">
                {settings.usage.uncertainRequests} request(s) have uncertain
                cost. Budgeted generation is blocked until an operator
                reconciles usage.
              </p>
            )}
            {settings.usage.activeRequest && (
              <p role="status">
                A generation is active. If it remains active after a server
                restart, an operator must reconcile it.
              </p>
            )}
            {!settings.available && (
              <p role="status">{settings.unavailableReason}</p>
            )}
            <label htmlFor="ai-instruction">
              Additional instruction (optional)
            </label>
            <textarea
              id="ai-instruction"
              rows={3}
              maxLength={1000}
              value={instruction}
              onChange={(e) => {
                setInstruction(e.target.value);
                setConfirming(false);
              }}
            />
            {preferencesDirty && (
              <p>Save your preference changes before generating.</p>
            )}
            <button
              type="button"
              className="button"
              disabled={
                !settings.available ||
                !settings.preferences.enabled ||
                !!preferencesDirty
              }
              onClick={() => void generate()}
            >
              {busy
                ? 'Generating…'
                : suggestion
                  ? 'Generate again'
                  : 'Generate suggestion'}
            </button>
            {confirming && (
              <div className="discard-prompt">
                <p>
                  This sends saved brand context to OpenAI and may incur a
                  charge. Maximum output: {settings.preferences.maxOutputTokens}{' '}
                  tokens. The server checks your selected estimated budget
                  before generation.
                </p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="button"
                    onClick={() => void generate(true)}
                  >
                    Confirm paid generation
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setConfirming(false)}
                  >
                    Cancel generation
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {suggestion && (
          <section aria-labelledby="suggestion-title">
            <h3 id="suggestion-title">
              AI suggestion — review before applying
            </h3>
            <pre className="ai-suggestion">{suggestion.text}</pre>
            <p>
              {suggestion.model} ·{' '}
              {suggestion.usage
                ? `${suggestion.usage.inputTokens} input / ${suggestion.usage.outputTokens} output tokens`
                : 'Token usage unavailable'}{' '}
              ·{' '}
              {suggestion.estimatedCostUsd === null
                ? 'Cost estimate unavailable; reservation retained.'
                : `Estimated cost $${suggestion.estimatedCostUsd.toFixed(6)} (not billed cost).`}
              {suggestion.costUncertain &&
                ' Cost needs operator reconciliation before further budgeted generation.'}
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="button"
                onClick={() => onApply(suggestion.text)}
              >
                Apply suggestion
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setSuggestion(null);
                  setNotice(
                    'Suggestion discarded. Your draft has not changed.',
                  );
                }}
              >
                Discard suggestion
              </button>
            </div>
          </section>
        )}
      </fieldset>
      <p role="status" className="form-notice">
        {busy ? 'Working… No automatic retries.' : notice}
      </p>
      <p role="alert" className="form-error">
        {error}
      </p>
    </section>
  );
}
