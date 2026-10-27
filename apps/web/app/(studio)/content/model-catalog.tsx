'use client';
import { useEffect, useState } from 'react';
import type { AiCapability, AiModel, AiModelCatalog } from '@synvaro/contracts';
export function useModelCatalog(capability: AiCapability) {
  const [models, setModels] = useState<AiModel[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void fetch('/api/ai/models', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const catalog = (await response.json()) as AiModelCatalog;
        if (active) setModels(catalog.models);
      })
      .catch(() => {
        if (active)
          setError('Unable to load supported models. Refresh to try again.');
      });
    return () => {
      active = false;
    };
  }, []);
  return {
    models:
      models?.filter((m) => m.capability === capability && m.implemented) ?? [],
    planned: models?.filter((m) => m.status === 'PLANNED') ?? [],
    message: error || (models === null ? 'Loading supported models…' : ''),
  };
}
export function ModelOptions({ models }: { models: AiModel[] }) {
  return models.map((m) => (
    <option
      key={`${m.provider}/${m.model}`}
      value={m.model}
      disabled={m.status !== 'AVAILABLE'}
    >
      {m.provider} · {m.model}
      {m.status !== 'AVAILABLE' ? ' — not configured' : ''}
    </option>
  ));
}
