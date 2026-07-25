/**
 * mediabunny-backed conversion, run inside the offscreen document.
 *
 * The offscreen document is an extension page, so its fetches inherit the
 * extension's host permissions — that's what lets us pull bytes straight from
 * video.twimg.com without CORS trouble, and lets mediabunny use range requests
 * instead of buffering whole files.
 */
import {
  ALL_FORMATS,
  AdtsOutputFormat,
  BufferTarget,
  Conversion,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  UrlSource,
  WavOutputFormat,
  canEncodeAudio,
  type AudioCodec,
  type DiscardedTrack,
  type OutputFormat,
} from 'mediabunny';

export type ProgressFn = (ratio: number) => void;

export interface ConvertResult {
  blob: Blob;
  mimeType: string;
}

const PROBED_CODECS: AudioCodec[] = ['aac', 'mp3', 'opus', 'pcm-s16'];

/**
 * Chrome's WebCodecs ships no MP3 encoder, so mediabunny's LAME extension fills
 * the gap. Registering it is cheap (the WASM loads lazily on first encode), but
 * we only do it when the browser genuinely lacks native support, per the
 * package's own guidance.
 */
let mp3Registration: Promise<void> | null = null;

function ensureMp3Encoder(): Promise<void> {
  if (!mp3Registration) {
    mp3Registration = (async () => {
      if (await canEncodeAudio('mp3')) return;
      const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
      registerMp3Encoder();
    })().catch(() => {
      // Leave MP3 unavailable rather than breaking the other formats
    });
  }
  return mp3Registration;
}

/**
 * Which audio codecs this browser can actually encode. MP3 encoding in
 * particular is missing from most WebCodecs implementations, so the menu grays
 * it out rather than failing halfway through a conversion.
 */
export async function probeAudioCodecs(): Promise<Record<string, boolean>> {
  // Register the LAME fallback first so the MP3 probe reflects reality
  await ensureMp3Encoder();

  const entries = await Promise.all(
    PROBED_CODECS.map(async (codec) => {
      try {
        return [codec, await canEncodeAudio(codec)] as const;
      } catch {
        return [codec, false] as const;
      }
    })
  );

  return Object.fromEntries(entries);
}

function outputFormatForAudio(codec: AudioCodec | null): OutputFormat {
  switch (codec) {
    case 'mp3':
      return new Mp3OutputFormat();
    case 'opus':
      return new OggOutputFormat();
    case 'pcm-s16':
      return new WavOutputFormat();
    case 'aac':
      return new AdtsOutputFormat();
    default:
      // `null` means "keep whatever the source uses" — MP4 is the container
      // that can hold X's native AAC without re-encoding.
      return new Mp4OutputFormat({ fastStart: 'in-memory' });
  }
}

function mimeForCodec(codec: AudioCodec | null): string {
  switch (codec) {
    case 'mp3':
      return 'audio/mpeg';
    case 'opus':
      return 'audio/ogg';
    case 'pcm-s16':
      return 'audio/wav';
    case 'aac':
      return 'audio/aac';
    default:
      return 'audio/mp4';
  }
}

/**
 * Turns mediabunny's discard reasons into something a user can act on.
 * `discarded_by_user` is filtered out because that's us dropping the video
 * track on purpose, not a failure.
 */
function describeFailure(tracks: DiscardedTrack[], fallback: string): string {
  const reasons = [
    ...new Set(
      tracks
        .filter((t) => t.reason !== 'discarded_by_user')
        .map((t) => {
          switch (t.reason) {
            case 'unknown_source_codec':
              return 'unrecognised source codec';
            case 'undecodable_source_codec':
              return 'this browser cannot decode the source codec';
            case 'no_encodable_target_codec':
              return 'this browser cannot encode the chosen format';
            default:
              return t.reason;
          }
        })
    ),
  ];

  return reasons.join(', ') || fallback;
}

function makeInput(url: string): Input {
  return new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(url),
  });
}

function toBlob(target: BufferTarget, mimeType: string): Blob {
  const buffer = target.buffer;
  if (!buffer) throw new Error('Conversion produced no output');
  return new Blob([buffer], { type: mimeType });
}

/** Strips the video track and writes an audio-only file. */
export async function extractAudio(
  url: string,
  codec: AudioCodec | null,
  bitrate: number,
  onProgress?: ProgressFn
): Promise<ConvertResult> {
  if (codec === 'mp3') await ensureMp3Encoder();

  const input = makeInput(url);
  const mimeType = mimeForCodec(codec);

  const output = new Output({
    format: outputFormatForAudio(codec),
    target: new BufferTarget(),
  });

  const conversion = await Conversion.init({
    input,
    output,
    video: { discard: true },
    // Omitting `codec` tells mediabunny to copy the source track untouched,
    // which is both lossless and roughly instant.
    audio: codec ? { codec, bitrate } : {},
    showWarnings: false,
  });

  if (!conversion.isValid) {
    throw new Error(
      describeFailure(conversion.discardedTracks, 'No convertible audio track in this video')
    );
  }

  if (onProgress) conversion.onProgress = onProgress;

  await conversion.execute();
  return { blob: toBlob(output.target as BufferTarget, mimeType), mimeType };
}

/**
 * Remuxes an adaptive (HLS) stream into a single MP4. Tracks are copied rather
 * than re-encoded, so this is I/O-bound, not CPU-bound.
 */
export async function remuxToMp4(url: string, onProgress?: ProgressFn): Promise<ConvertResult> {
  const input = makeInput(url);

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  });

  const conversion = await Conversion.init({ input, output, showWarnings: false });

  if (!conversion.isValid) {
    throw new Error(describeFailure(conversion.discardedTracks, 'Stream could not be remuxed'));
  }

  if (onProgress) conversion.onProgress = onProgress;

  await conversion.execute();
  return { blob: toBlob(output.target as BufferTarget, 'video/mp4'), mimeType: 'video/mp4' };
}
