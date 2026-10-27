// Real PostgreSQL + built Next/Nest; only external AI providers are mocked.
import { Buffer, Blob } from 'node:buffer';
const { FormData } = globalThis;
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../packages/database/dist/index.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const mediaRoot = await mkdtemp(join(tmpdir(), 'synvaro-media-smoke-'));
const children = [];
function start(args, cwd, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });
  child.on('error', () => {});
  const entry = { child, output: () => output, exited: once(child, 'exit') };
  children.push(entry);
  return entry;
}
async function ready(url, entry) {
  for (let i = 0; i < 120; i++) {
    if (entry.child.exitCode !== null)
      throw new Error(`Process exited: ${entry.output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* Wait for the listening socket. */
    }
    await delay(250);
  }
  throw new Error(`Startup timed out: ${entry.output()}`);
}
const databaseUrl = process.env.DATABASE_URL;
assert.ok(
  databaseUrl && new URL(databaseUrl).pathname.endsWith('_test'),
  'Use a dedicated PostgreSQL database ending in _test',
);
const db = createDatabase(databaseUrl);
const email = `smoke-${randomUUID()}@example.test`;
const password = `Test-only-${randomUUID()}`;
const origin = 'http://127.0.0.1:43100';
async function auth(action, body, cookie = '', requestOrigin = origin) {
  return fetch(`${origin}/api/auth/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      origin: requestOrigin,
      cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
}
try {
  const api = start(['dist/test/ai-preview.js'], 'apps/api', {
    MEDIA_STORAGE_ROOT: mediaRoot,
    API_PORT: '43101',
    API_HOST: '127.0.0.1',
    NODE_ENV: 'test',
    WEB_ORIGIN: origin,
  });
  const web = start(
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '43100',
    ],
    'apps/web',
    { API_INTERNAL_URL: 'http://127.0.0.1:43101', WEB_ORIGIN: origin },
  );
  const health = await ready('http://127.0.0.1:43101/health', api);
  assert.deepEqual(await health.json(), {
    status: 'ok',
    service: 'synvaro-api',
  });
  await ready(`${origin}/login`, web);
  const anonymous = await fetch(`${origin}/brands`, { redirect: 'manual' });
  assert.equal(anonymous.status, 307);
  assert.equal(anonymous.headers.get('location'), '/login');
  assert.equal(
    (await auth('register', { email, password }, '', 'https://evil.example'))
      .status,
    403,
  );
  assert.equal((await auth('register', { email, password })).status, 201);
  const login = await auth('login', { email, password });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie') ?? '';
  assert.ok(/HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie));
  const cookie = setCookie.split(';')[0];
  const body = await login.text();
  assert.ok(!body.includes(password) && !body.includes(cookie.split('=')[1]));
  assert.equal((await auth('me', undefined, cookie)).status, 200);
  assert.equal((await fetch(`${origin}/api/ai/models`)).status, 401);
  const catalogResponse = await fetch(`${origin}/api/ai/models`, {
    headers: { cookie },
  });
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(
    catalog.models.filter((m) => m.status === 'AVAILABLE').length,
    6,
  );
  assert.ok(
    catalog.models.some(
      (m) =>
        m.provider === 'google' &&
        m.capability === 'IMAGE_EDITING' &&
        m.status === 'AVAILABLE',
    ),
  );
  assert.ok(
    catalog.models
      .filter((m) => !m.implemented)
      .every((m) => m.status === 'PLANNED'),
  );

  for (let i = 0; i < 2; i++) {
    const home = await fetch(origin, { headers: { cookie } });
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /Create your organization/);
    assert.ok(html.includes(email));
  }
  async function product(path, method = 'GET', data, requestOrigin = origin) {
    return fetch(`${origin}/api${path}`, {
      method,
      headers: {
        cookie,
        origin: requestOrigin,
        'content-type': 'application/json',
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  }
  assert.deepEqual(await (await product('/organizations/me')).json(), {
    organization: null,
  });
  assert.equal(
    (
      await product(
        '/organizations',
        'POST',
        { name: 'Forbidden' },
        'https://evil.example',
      )
    ).status,
    403,
  );
  const organizationName = `Smoke organization ${randomUUID()}`;
  assert.equal(
    (await product('/organizations', 'POST', { name: organizationName }))
      .status,
    201,
  );
  const created = await product('/brands', 'POST', {
    name: 'First smoke brand',
    description: 'Initial description',
  });
  assert.equal(created.status, 201);
  const { brand } = await created.json();
  assert.equal(
    (await product('/brands', 'POST', { name: 'Second smoke brand' })).status,
    201,
  );
  assert.equal(
    (
      await product(
        `/brands/${brand.id}`,
        'PATCH',
        { name: 'Forbidden' },
        'https://evil.example',
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await product(`/brands/${brand.id}`, 'PATCH', {
        name: 'Edited smoke brand',
        description: 'Persisted edit',
      })
    ).status,
    200,
  );
  for (let i = 0; i < 2; i++) {
    const page = await fetch(`${origin}/brands`, { headers: { cookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(
      html.includes(organizationName) &&
        html.includes('Edited smoke brand') &&
        html.includes('Persisted edit') &&
        html.includes('Second smoke brand'),
    );
  }
  const persisted = await (await product('/brands')).json();
  assert.equal(persisted.brands.length, 2);
  assert.equal(
    persisted.brands.find((item) => item.id === brand.id).description,
    'Persisted edit',
  );
  // BRP-001-A1/A3/A8: profile through the actual Next proxy and refreshed SSR.
  const profilePath = `/brands/${brand.id}/profile`;
  assert.deepEqual(await (await product(profilePath)).json(), {
    profile: null,
  });
  assert.equal(
    (
      await product(
        profilePath,
        'PUT',
        { description: 'Forbidden' },
        'https://evil.example',
      )
    ).status,
    403,
  );
  const detail = '文'.repeat(3000);
  assert.equal(
    (
      await product(profilePath, 'PUT', {
        description: detail,
        targetAudience: 'Local business owners',
        toneOfVoice: 'Warm and factual',
        defaultLanguage: 'tr-tr',
        contentGuidelines: 'No invented claims',
      })
    ).status,
    200,
  );
  assert.equal(
    (await product(profilePath, 'PUT', { toneOfVoice: 'Clear and helpful' }))
      .status,
    200,
  );
  const profile = (await (await product(profilePath)).json()).profile;
  assert.equal(profile.description, detail);
  assert.equal(profile.targetAudience, 'Local business owners');
  assert.equal(profile.defaultLanguage, 'tr-TR');
  for (let i = 0; i < 2; i++) {
    const page = await fetch(`${origin}${profilePath}`, {
      headers: { cookie },
    });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(
      html.includes('Clear and helpful') &&
        html.includes('Local business owners') &&
        html.includes('No invented claims'),
    );
  }
  // CNT-001–004: manual drafts through Next, scoped brand lists and refreshed editor.
  assert.equal(
    (
      await product(
        '/contents',
        'POST',
        { brandId: brand.id, title: 'Forbidden' },
        'https://evil.example',
      )
    ).status,
    403,
  );
  const createdDraft = await product('/contents', 'POST', {
    brandId: brand.id,
    title: 'Hypothetical draft only',
    body: '文'.repeat(10000),
  });
  assert.equal(createdDraft.status, 201);
  const draft = (await createdDraft.json()).content;
  assert.equal(draft.status, 'DRAFT');
  assert.equal(
    (
      await product(`/contents/${draft.id}`, 'PATCH', {
        body: 'Hypothetical revised copy. No release claims.',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await product(
        `/contents/${draft.id}`,
        'PATCH',
        { body: 'Forbidden' },
        'https://evil.example',
      )
    ).status,
    403,
  );
  const secondBrand = persisted.brands.find((item) => item.id !== brand.id);
  assert.deepEqual(
    await (await product(`/contents?brandId=${secondBrand.id}`)).json(),
    { contents: [] },
  );
  assert.equal(
    (await (await product(`/contents?brandId=${brand.id}`)).json()).contents[0]
      .id,
    draft.id,
  );
  for (let i = 0; i < 2; i++) {
    const page = await fetch(`${origin}/content/${draft.id}`, {
      headers: { cookie },
    });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(
      html.includes('Hypothetical draft only') &&
        html.includes('Hypothetical revised copy. No release claims.') &&
        html.includes('Edited smoke brand'),
    );
  }
  const listing = await fetch(`${origin}/content?brandId=${brand.id}`, {
    headers: { cookie },
  });
  assert.ok((await listing.text()).includes('Hypothetical draft only'));
  for (const section of ['calendar']) {
    const response = await fetch(`${origin}/${section}`, {
      headers: { cookie },
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Coming later/);
  }
  // MED-001–004: streaming multipart through Next, original bytes and brand isolation.
  const png = await readFile('apps/api/src/test/fixtures/media/sample.png');
  async function uploadMedia(requestOrigin = origin) {
    const data = new FormData();
    data.append('file', new Blob([png], { type: 'image/png' }), 'smoke.png');
    return fetch(`${origin}/api/brands/${brand.id}/media`, {
      method: 'POST',
      headers: { cookie, origin: requestOrigin },
      body: data,
    });
  }
  assert.equal((await uploadMedia('https://evil.example')).status, 403);
  const uploaded = await uploadMedia();
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const media = (await uploaded.json()).asset;
  assert.equal(
    (await (await product(`/brands/${brand.id}/media`)).json()).assets[0].id,
    media.id,
  );
  assert.deepEqual(
    await (await product(`/brands/${secondBrand.id}/media`)).json(),
    { assets: [] },
  );
  const original = await fetch(`${origin}/api/media/${media.id}/file`, {
    headers: { cookie },
  });
  assert.equal(original.status, 200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), png);
  assert.equal(original.headers.get('cache-control'), 'private, no-store');
  const range = await fetch(`${origin}/api/media/${media.id}/file`, {
    headers: { cookie, range: 'bytes=0-7' },
  });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), png.subarray(0, 8));
  assert.equal(
    (await fetch(`${origin}/api/media/${media.id}/file`)).status,
    401,
  );
  // CMA-001–005: existing media relationships through the real Next proxy.
  const attachmentPath = `/contents/${draft.id}/media`;
  assert.deepEqual(await (await product(attachmentPath)).json(), {
    attachments: [],
  });
  assert.equal(
    (
      await product(
        attachmentPath,
        'POST',
        { mediaAssetId: media.id },
        'https://evil.example',
      )
    ).status,
    403,
  );
  assert.equal(
    (await product(attachmentPath, 'POST', { mediaAssetId: media.id })).status,
    201,
  );
  assert.equal(
    (await product(attachmentPath, 'POST', { mediaAssetId: media.id })).status,
    409,
  );
  const secondUpload = await uploadMedia();
  assert.equal(secondUpload.status, 201);
  const secondMedia = (await secondUpload.json()).asset;
  assert.equal(
    (await product(attachmentPath, 'POST', { mediaAssetId: secondMedia.id }))
      .status,
    201,
  );
  assert.equal(
    (
      await product(attachmentPath + '/order', 'PUT', {
        mediaAssetIds: [secondMedia.id, media.id],
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await (await product(attachmentPath)).json()).attachments.map(
      (item) => item.mediaAssetId,
    ),
    [secondMedia.id, media.id],
  );
  assert.equal(
    (
      await product(attachmentPath + '/order', 'PUT', {
        mediaAssetIds: [media.id],
      })
    ).status,
    409,
  );
  assert.equal(
    (await product(attachmentPath + '/' + media.id, 'DELETE', {})).status,
    200,
  );
  assert.equal((await product(`/media/${media.id}`)).status, 200);
  assert.equal(
    (await (await product(`/contents/${draft.id}`)).json()).content.body,
    'Hypothetical revised copy. No release claims.',
  );
  const mediaPage = await fetch(`${origin}/media?brandId=${brand.id}`, {
    headers: { cookie },
  });
  assert.equal(mediaPage.status, 200);
  assert.match(
    await mediaPage.text(),
    /Uploaded originals and accepted AI images/,
  );
  assert.equal(
    (await fetch(`${origin}/unknown-section`, { headers: { cookie } })).status,
    404,
  );
  // AIG-001–005: deterministic provider, real persistence and Next/Nest boundary.
  const initialAI = await (await product('/ai/preferences')).json();
  assert.equal(initialAI.preferences.enabled, false);
  assert.equal(
    (
      await product('/ai/preferences', 'PUT', {
        ...initialAI.preferences,
        enabled: true,
        monthlyBudgetUsd: 0.01,
      })
    ).status,
    200,
  );
  const beforeAI = (await (await product(`/contents/${draft.id}`)).json())
    .content;
  const generated = await product(
    `/contents/${draft.id}/ai-generations`,
    'POST',
    {
      requestId: randomUUID(),
      confirmed: true,
      instruction: 'Hypothetical copy only',
    },
  );
  assert.equal(generated.status, 201);
  const suggestion = await generated.json();
  assert.ok(suggestion.text.includes('test-provider suggestion'));
  assert.equal(suggestion.usage.outputTokens, 50);
  assert.deepEqual(
    (await (await product(`/contents/${draft.id}`)).json()).content,
    beforeAI,
  );
  assert.equal(
    (await product(`/contents/${draft.id}`, 'PATCH', { body: suggestion.text }))
      .status,
    200,
  );
  const refreshedAI = await fetch(`${origin}/content/${draft.id}`, {
    headers: { cookie },
  });
  assert.ok((await refreshedAI.text()).includes(suggestion.text));
  const googlePrefs = (await (await product('/ai/preferences')).json())
    .preferences;
  assert.equal(
    (
      await product('/ai/preferences', 'PUT', {
        ...googlePrefs,
        model: 'gemini-3.8-flash',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await product(`/contents/${draft.id}/ai-generations`, 'POST', {
        requestId: randomUUID(),
        confirmed: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await product('/ai/preferences', 'PUT', {
        ...googlePrefs,
        model: 'gemini-3.8-flash',
        monthlyBudgetUsd: null,
      })
    ).status,
    200,
  );
  const googleResponse = await product(
    `/contents/${draft.id}/ai-generations`,
    'POST',
    {
      requestId: randomUUID(),
      confirmed: true,
      instruction: 'Hypothetical only',
    },
  );
  assert.equal(googleResponse.status, 201);
  const googleSuggestion = await googleResponse.json();
  assert.equal(googleSuggestion.model, 'gemini-3.8-flash');
  assert.equal(googleSuggestion.estimatedCostUsd, 0.000525);
  assert.equal(
    (await (await product(`/contents/${draft.id}`)).json()).content.body,
    suggestion.text,
  );
  // VOC-001–006: private, explicit voice preview/save/attach through Next and Nest.
  const voicePrefs = (await (await product('/ai/preferences')).json())
    .preferences;
  assert.equal(
    (
      await product('/ai/preferences', 'PUT', {
        ...voicePrefs,
        speechEnabled: true,
        monthlyBudgetUsd: 1,
      })
    ).status,
    200,
  );
  const voiceRequest = {
    requestId: randomUUID(),
    model: 'eleven_multilingual_v2',
    voiceId: 'JBFqnCBsd6RMkjVDRZzb',
    text: 'Merhaba, bu varsayımsal bir test anlatımıdır.',
    confirmed: true,
  };
  assert.equal(
    (
      await product(
        `/contents/${draft.id}/speech-generations`,
        'POST',
        voiceRequest,
      )
    ).status,
    409,
  );
  const voiceChoices = await (await product('/ai/voices')).json();
  assert.equal(voiceChoices.voices[0].id, voiceRequest.voiceId);
  assert.equal(
    (
      await product('/ai/preferences', 'PUT', {
        ...voicePrefs,
        speechEnabled: true,
        monthlyBudgetUsd: null,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await product(
        `/contents/${draft.id}/speech-generations`,
        'POST',
        voiceRequest,
        'https://evil.example',
      )
    ).status,
    403,
  );
  const speechResponse = await product(
    `/contents/${draft.id}/speech-generations`,
    'POST',
    voiceRequest,
  );
  assert.equal(speechResponse.status, 201);
  const speech = await speechResponse.json();
  const voicePreview = await fetch(
    `${origin}/api/speech-generations/${speech.id}/file`,
    { headers: { cookie } },
  );
  assert.equal(voicePreview.status, 200);
  assert.equal(voicePreview.headers.get('content-type'), 'audio/mpeg');
  const voiceBytes = Buffer.from(await voicePreview.arrayBuffer());
  const savedVoice = await product(
    `/speech-generations/${speech.id}/accept`,
    'POST',
    {},
  );
  assert.equal(savedVoice.status, 201);
  const voiceAsset = await savedVoice.json();
  assert.equal(voiceAsset.origin, 'AI_VOICE');
  assert.equal(voiceAsset.generation.voiceId, voiceRequest.voiceId);
  assert.equal(
    (
      await product(`/contents/${draft.id}/media`, 'POST', {
        mediaAssetId: voiceAsset.id,
      })
    ).status,
    201,
  );
  assert.deepEqual(
    Buffer.from(
      await (await product(`/media/${voiceAsset.id}/file`)).arrayBuffer(),
    ),
    voiceBytes,
  );
  assert.equal(
    (await (await product(`/contents/${draft.id}`)).json()).content.body,
    suggestion.text,
  );
  const imagePrefs = (await (await product('/ai/preferences')).json())
    .preferences;
  assert.equal(
    (
      await product('/ai/preferences', 'PUT', {
        ...imagePrefs,
        imageEnabled: true,
        monthlyBudgetUsd: null,
      })
    ).status,
    200,
  );
  const imageResponse = await product(
    `/contents/${draft.id}/image-generations`,
    'POST',
    {
      requestId: randomUUID(),
      instruction: 'Hypothetical conceptual illustration only',
      confirmed: true,
    },
  );
  assert.equal(imageResponse.status, 201);
  const image = await imageResponse.json();
  assert.equal(image.estimatedCostUsd, 0.0065);
  const preview = await fetch(
    `${origin}/api/image-generations/${image.id}/file`,
    { headers: { cookie } },
  );
  assert.equal(preview.status, 200);
  const previewBytes = Buffer.from(await preview.arrayBuffer());
  const accepted = await product(
    `/image-generations/${image.id}/accept`,
    'POST',
    {},
  );
  assert.equal(accepted.status, 201);
  const generatedAsset = await accepted.json();
  assert.equal(generatedAsset.origin, 'AI_GENERATED');
  assert.equal(generatedAsset.generation.id, image.id);
  assert.equal(
    (
      await product(`/contents/${draft.id}/media`, 'POST', {
        mediaAssetId: generatedAsset.id,
      })
    ).status,
    201,
  );
  const savedImage = await fetch(
    `${origin}/api/media/${generatedAsset.id}/file`,
    { headers: { cookie } },
  );
  assert.deepEqual(Buffer.from(await savedImage.arrayBuffer()), previewBytes);
  assert.equal(
    (await (await product(`/contents/${draft.id}`)).json()).content.body,
    suggestion.text,
  );
  assert.equal(
    (await auth('logout', {}, cookie, 'https://evil.example')).status,
    403,
  );
  assert.equal((await auth('me', undefined, cookie)).status, 200);

  assert.equal((await auth('logout', {}, cookie)).status, 200);
  assert.equal((await auth('me', undefined, cookie)).status, 401);
  assert.equal(
    (
      await fetch(`${origin}/api/media/${media.id}/file`, {
        headers: { cookie },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${origin}/brands`, {
        headers: { cookie },
        redirect: 'manual',
      })
    ).status,
    307,
  );
  console.info(
    'SYN-AI-004 (mock ElevenLabs) + prior slices passed: real PostgreSQL, Next/Nest auth, private voice preview/save/attach, media, CSRF and logout.',
  );
} finally {
  for (const { child, exited } of children) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    }
  }
  await db.aiGeneration.deleteMany({ where: { user: { email } } });
  await db.mediaAsset.deleteMany({
    where: { brand: { organization: { owner: { email } } } },
  });
  await db.user.deleteMany({ where: { email } });
  await rm(mediaRoot, { recursive: true, force: true });
  await db.$disconnect();
}
