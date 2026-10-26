'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { BrandProfile, BrandProfileResponse } from '@synvaro/contracts';

const fields = [
  [
    'description',
    'Brand description',
    'Describe what your brand does and offers. This detailed context is separate from the short summary on its brand card.',
  ],
  [
    'targetAudience',
    'Target audience',
    'Who are you speaking to? Include their needs, interests or location.',
  ],
  [
    'toneOfVoice',
    'Tone of voice',
    'How should your brand sound? For example: warm, clear and professional.',
  ],
  [
    'contentGuidelines',
    'Content guidelines',
    'Add communication rules, restrictions and preferences.',
  ],
] as const;
function values(profile: BrandProfile | null) {
  return {
    description: profile?.description ?? '',
    targetAudience: profile?.targetAudience ?? '',
    toneOfVoice: profile?.toneOfVoice ?? '',
    defaultLanguage: profile?.defaultLanguage ?? '',
    contentGuidelines: profile?.contentGuidelines ?? '',
  };
}
export function ProfileEditor({
  brandId,
  brandName,
  initialProfile,
}: {
  brandId: string;
  brandName: string;
  initialProfile: BrandProfile | null;
}) {
  const [saved, setSaved] = useState(values(initialProfile));
  const [draft, setDraft] = useState(values(initialProfile));
  const [exists, setExists] = useState(!!initialProfile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const navigate = (event: MouseEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest('a, .logout-button')
          : null;
      if (
        target &&
        !window.confirm('Discard your unsaved brand profile changes?')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', navigate, true);
    };
  }, [dirty]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (draft.defaultLanguage.trim()) {
      try {
        Intl.getCanonicalLocales(draft.defaultLanguage.trim());
      } catch {
        setError('Use a valid language tag, such as tr, en-GB or zh-Hant.');
        return;
      }
    }
    const changed = Object.fromEntries(
      Object.entries(draft)
        .filter(([key, value]) => value !== saved[key as keyof typeof saved])
        .map(([key, value]) => [
          key,
          key === 'defaultLanguage' ? value.trim() || null : value,
        ]),
    );
    setBusy(true);
    try {
      const response = await fetch(`/api/brands/${brandId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changed),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(
          response.status === 401
            ? 'Your session expired. Copy your changes before signing in again.'
            : (result.message ?? 'Unable to save your profile.'),
        );
        return;
      }
      const next = values((result as BrandProfileResponse).profile);
      setSaved(next);
      setDraft(next);
      setExists(true);
      setNotice('Brand profile saved.');
    } catch {
      setError(
        'Unable to connect. Your changes are still here; please try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-section">
      <Link className="auth-link" href="/brands">
        Back to brands
      </Link>
      <p className="eyebrow profile-brand-name">{brandName}</p>
      <h1>Brand profile</h1>
      <p className="intro">
        Your reference for how this brand communicates. Saved profile details
        provide context when you request an AI suggestion from a content draft.
      </p>
      {!exists && (
        <p className="profile-empty">
          No brand profile yet. Add what you know; you can complete the other
          fields later.
        </p>
      )}
      <form className="brand-form-card" onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy}>
          {fields.slice(0, 3).map(([key, label, hint]) => (
            <div key={key} className="profile-field">
              <label htmlFor={key}>{label}</label>
              <small id={`${key}-help`}>{hint} Up to 4,000 characters.</small>
              <textarea
                id={key}
                aria-describedby={`${key}-help`}
                rows={4}
                maxLength={4000}
                value={draft[key]}
                onChange={(event) => {
                  setDraft({ ...draft, [key]: event.target.value });
                  setNotice('');
                }}
              />
            </div>
          ))}
          <div className="profile-field">
            <label htmlFor="defaultLanguage">Default language</label>
            <small id="language-help">
              Use a language tag: tr for Turkish, en-GB for British English, or
              zh-Hant for Traditional Chinese. Leave blank if undecided.
            </small>
            <input
              id="defaultLanguage"
              aria-describedby="language-help"
              maxLength={100}
              value={draft.defaultLanguage}
              onChange={(event) => {
                setDraft({ ...draft, defaultLanguage: event.target.value });
                setNotice('');
              }}
              placeholder="For example, tr-TR"
            />
          </div>
          <div className="profile-field">
            <label htmlFor="contentGuidelines">Content guidelines</label>
            <small id="guidelines-help">
              Add communication rules, restrictions and preferences. Up to 4,000
              characters.
            </small>
            <textarea
              id="contentGuidelines"
              aria-describedby="guidelines-help"
              rows={4}
              maxLength={4000}
              value={draft.contentGuidelines}
              onChange={(event) => {
                setDraft({ ...draft, contentGuidelines: event.target.value });
                setNotice('');
              }}
            />
          </div>
          <p role="status" className="form-notice">
            {notice || (dirty ? 'You have unsaved changes.' : '')}
          </p>
          <p role="alert" className="form-error">
            {error}
          </p>
          <div className="form-actions">
            <button className="button" type="submit" disabled={!dirty}>
              {busy ? 'Saving…' : 'Save profile'}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!dirty}
              onClick={() => {
                if (
                  window.confirm('Discard your unsaved brand profile changes?')
                ) {
                  setDraft(saved);
                  setError('');
                  setNotice('Changes discarded.');
                }
              }}
            >
              Discard changes
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
