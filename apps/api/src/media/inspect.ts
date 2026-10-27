import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { open, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
const execute = promisify(execFile);
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;
export const MAX_GENERATED_AUDIO_BYTES = 5 * 1024 * 1024;
const bad = () =>
  new BadRequestException(
    'Unsupported or malformed media. Use JPEG, PNG, static WebP or H.264 MP4.',
  );
export async function inspectMedia(path: string) {
  const file = await open(path, 'r');
  const head = Buffer.alloc(32);
  try {
    await file.read(head, 0, head.length, 0);
  } finally {
    await file.close();
  }
  const imageType = head.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
    ? 'jpeg'
    : head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : head.toString('ascii', 0, 4) === 'RIFF' &&
          head.toString('ascii', 8, 12) === 'WEBP'
        ? 'webp'
        : null;
  if (imageType) {
    try {
      const image = sharp(path, {
        failOn: 'warning',
        limitInputPixels: 16000000,
        animated: false,
      });
      const metadata = await image.metadata();
      if (
        metadata.format !== imageType ||
        (metadata.pages ?? 1) !== 1 ||
        !metadata.width ||
        !metadata.height
      )
        throw bad();
      // Decode every pixel to validate structure; never replace/re-encode the original file.
      await image.stats();
      return {
        mimeType: `image/${imageType}`,
        width: metadata.width,
        height: metadata.height,
        durationMs: null,
      };
    } catch {
      throw bad();
    }
  }
  if (head.toString('ascii', 4, 8) !== 'ftyp') throw bad();
  if (
    ![
      'isom',
      'iso2',
      'iso3',
      'iso4',
      'iso5',
      'iso6',
      'avc1',
      'mp41',
      'mp42',
      'dash',
    ].includes(head.toString('ascii', 8, 12))
  )
    throw bad();
  // Check top-level box bounds, catching truncated mdat/moov before probing packets.
  const size = (await stat(path)).size;
  let offset = 0;
  const types = new Set<string>();
  const handle = await open(path, 'r');
  try {
    while (offset < size) {
      const box = Buffer.alloc(16);
      const read = await handle.read(box, 0, 16, offset);
      if (read.bytesRead < 8) throw bad();
      let length = box.readUInt32BE(0);
      const type = box.toString('ascii', 4, 8);
      let header = 8;
      if (length === 1) {
        if (read.bytesRead < 16) throw bad();
        const wide = box.readBigUInt64BE(8);
        if (wide > BigInt(size)) throw bad();
        length = Number(wide);
        header = 16;
      }
      if (length === 0) length = size - offset;
      if (length < header || offset + length > size) throw bad();
      types.add(type);
      offset += length;
    }
  } finally {
    await handle.close();
  }
  if (!types.has('moov') || !types.has('mdat')) throw bad();
  try {
    const { stdout, stderr } = await execute(
      process.env.FFPROBE_PATH || 'ffprobe',
      [
        '-v',
        'error',
        '-max_alloc',
        '67108864',
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        'mov',
        '-enable_drefs',
        '0',
        '-use_absolute_path',
        '0',
        '-count_packets',
        '-show_entries',
        'stream=codec_name,codec_type,width,height,nb_read_packets:format=duration,format_name',
        '-of',
        'json',
        path,
      ],
      { timeout: 10000, maxBuffer: 65536 },
    );
    if (stderr.trim()) throw bad();
    const result = JSON.parse(stdout) as {
      streams: {
        codec_name: string;
        codec_type: string;
        width?: number;
        height?: number;
        nb_read_packets?: string;
      }[];
      format: { duration: string; format_name: string };
    };
    const videos = result.streams.filter(
      (stream) => stream.codec_type === 'video',
    );
    const durationMs = Math.round(Number(result.format.duration) * 1000);
    if (
      videos.length !== 1 ||
      videos[0]!.codec_name !== 'h264' ||
      !videos[0]!.width ||
      !videos[0]!.height ||
      videos[0]!.width * videos[0]!.height > 16000000 ||
      !(Number(videos[0]!.nb_read_packets) > 0) ||
      !Number.isSafeInteger(durationMs) ||
      durationMs <= 0 ||
      durationMs > 2147483647 ||
      result.streams.some(
        (stream) =>
          stream.codec_type !== 'video' &&
          (stream.codec_type !== 'audio' || stream.codec_name !== 'aac'),
      )
    )
      throw bad();
    return {
      mimeType: 'video/mp4',
      width: videos[0]!.width,
      height: videos[0]!.height,
      durationMs,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new ServiceUnavailableException('MP4 validation requires ffprobe');
    throw bad();
  }
}

/** Generated MP3 only. Upload validation remains image/MP4-only. */
export async function inspectGeneratedAudio(path: string) {
  const size = (await stat(path)).size;
  if (size < 128 || size > MAX_GENERATED_AUDIO_BYTES)
    throw new BadRequestException('Invalid generated audio');
  const file = await open(path, 'r');
  const head = Buffer.alloc(10);
  try {
    await file.read(head, 0, head.length, 0);
  } finally {
    await file.close();
  }
  if (
    head.toString('ascii', 0, 3) !== 'ID3' &&
    !(head[0] === 0xff && (head[1]! & 0xe0) === 0xe0)
  )
    throw new BadRequestException('Invalid generated audio');
  try {
    const { stdout, stderr } = await execute(
      process.env.FFPROBE_PATH || 'ffprobe',
      [
        '-v',
        'error',
        '-max_alloc',
        '67108864',
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        'mp3',
        '-count_packets',
        '-show_entries',
        'stream=codec_name,codec_type,nb_read_packets:format=duration,format_name',
        '-of',
        'json',
        path,
      ],
      { timeout: 10000, maxBuffer: 65536 },
    );
    if (stderr.trim()) throw new Error('Probe warning');
    const data = JSON.parse(stdout) as {
      streams: {
        codec_name: string;
        codec_type: string;
        nb_read_packets?: string;
      }[];
      format: { duration: string; format_name: string };
    };
    const durationMs = Math.round(Number(data.format.duration) * 1000);
    if (
      !data.format.format_name.split(',').includes('mp3') ||
      data.streams.length !== 1 ||
      data.streams[0]?.codec_name !== 'mp3' ||
      data.streams[0]?.codec_type !== 'audio' ||
      !(Number(data.streams[0]?.nb_read_packets) > 0) ||
      !Number.isSafeInteger(durationMs) ||
      durationMs <= 0 ||
      durationMs > 600_000
    )
      throw new Error('Invalid MP3');
    return {
      mimeType: 'audio/mpeg',
      width: null,
      height: null,
      durationMs,
      sizeBytes: size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new ServiceUnavailableException('MP3 validation requires ffprobe');
    throw new BadRequestException('Invalid generated audio');
  }
}
