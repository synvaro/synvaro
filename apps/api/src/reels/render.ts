import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import sharp from 'sharp';
import { inspectGeneratedAudio, inspectMedia } from '../media/inspect.js';
import { MAX_FILE_BYTES } from '../media/inspect.js';

const run = promisify(execFile);
export type ReelScene = {
  mediaAssetId: string;
  imageDurationSec?: number;
  videoStartSec?: number;
  videoDurationSec?: number;
  text?: string;
  placement?: 'top' | 'center' | 'bottom';
};
export type RenderSource = ReelScene & {
  path: string;
  mimeType: string;
  durationMs: number | null;
};
const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[ch]!,
  );

async function overlay(text: string, placement: string, path: string) {
  const words = text.trim().split(/\s+/u);
  const lines: string[] = [''];
  for (const word of words) {
    const current = lines.at(-1)!;
    if (current && (current + ' ' + word).length > 27) lines.push(word);
    else lines[lines.length - 1] = current ? `${current} ${word}` : word;
  }
  if (lines.length > 5 || lines.some((line) => line.length > 35))
    throw new Error('OVERLAY_TOO_LONG');
  const height = lines.length * 67 + 52;
  const top =
    placement === 'top'
      ? 180
      : placement === 'bottom'
        ? 1660 - height
        : Math.round((1920 - height) / 2);
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="540" y="${top + 63 + index * 67}">${xml(line)}</tspan>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect x="70" y="${top}" width="940" height="${height}" rx="24" fill="#000" fill-opacity="0.68"/><text text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="50" font-weight="bold" fill="white">${tspans}</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path);
}

export async function renderReel(
  scenes: RenderSource[],
  narrationPath: string | null,
  dir: string,
) {
  const args = [
    '-y',
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-filter_complex_threads',
    '1',
  ];
  const filters: string[] = [];
  let input = 0;
  let duration = 0;
  for (const [index, scene] of scenes.entries()) {
    const seconds = scene.mimeType.startsWith('image/')
      ? scene.imageDurationSec!
      : scene.videoDurationSec!;
    duration += seconds;
    if (scene.mimeType.startsWith('image/'))
      args.push(
        '-loop',
        '1',
        '-framerate',
        '30',
        '-t',
        String(seconds),
        '-i',
        scene.path,
      );
    else
      args.push(
        '-ss',
        String(scene.videoStartSec!),
        '-t',
        String(seconds),
        '-i',
        scene.path,
      );
    const sourceInput = input++;
    const crop = scene.mimeType.startsWith('image/')
      ? 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x182720'
      : 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920';
    filters.push(
      `[${sourceInput}:v]${crop},setsar=1,fps=30,trim=duration=${seconds},setpts=PTS-STARTPTS,format=yuv420p[base${index}]`,
    );
    if (scene.text) {
      const layer = join(dir, `overlay-${index}.png`);
      await overlay(scene.text, scene.placement ?? 'bottom', layer);
      args.push(
        '-loop',
        '1',
        '-framerate',
        '30',
        '-t',
        String(seconds),
        '-i',
        layer,
      );
      filters.push(
        `[base${index}][${input++}:v]overlay=0:0:shortest=1,format=yuv420p[v${index}]`,
      );
    } else filters.push(`[base${index}]null[v${index}]`);
  }
  filters.push(
    `${scenes.map((_, i) => `[v${i}]`).join('')}concat=n=${scenes.length}:v=1:a=0[outv]`,
  );
  if (narrationPath) {
    args.push('-i', narrationPath);
    filters.push(
      `[${input}:a]apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[outa]`,
    );
  }
  const output = join(dir, 'reel.mp4');
  args.push('-filter_complex', filters.join(';'), '-map', '[outv]');
  if (narrationPath) args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '128k');
  else args.push('-an');
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-threads',
    '1',
    '-b:v',
    '1800k',
    '-maxrate',
    '2200k',
    '-bufsize',
    '4400k',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-movflags',
    '+faststart',
    '-t',
    String(duration),
    output,
  );
  await run(process.env.FFMPEG_PATH || 'ffmpeg', args, {
    timeout: 180_000,
    killSignal: 'SIGKILL',
    maxBuffer: 8192,
  });
  if ((await stat(output)).size > MAX_FILE_BYTES)
    throw new Error('OUTPUT_TOO_LARGE');
  const details = await inspectMedia(output);
  if (
    details.mimeType !== 'video/mp4' ||
    details.width !== 1080 ||
    details.height !== 1920 ||
    !details.durationMs ||
    Math.abs(details.durationMs - duration * 1000) > 1000
  )
    throw new Error('OUTPUT_INVALID');
  return { output, details };
}

export async function verifySource(path: string, mimeType: string) {
  const details =
    mimeType === 'audio/mpeg'
      ? await inspectGeneratedAudio(path)
      : await inspectMedia(path);
  if (details.mimeType !== mimeType) throw new Error('SOURCE_INVALID');
  return details;
}
