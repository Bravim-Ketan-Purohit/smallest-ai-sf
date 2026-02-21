export interface MicStreamHandle {
  stop: () => Promise<void>;
}

const TARGET_SAMPLE_RATE = 16000;
const PROCESSOR_BUFFER_SIZE = 4096;
const DEMO_FRAME_SECONDS = 0.16;
const DEMO_FRAME_SAMPLES = Math.floor(TARGET_SAMPLE_RATE * DEMO_FRAME_SECONDS);

export async function startMicPcmStream(onChunk: (chunk: ArrayBuffer) => void): Promise<MicStreamHandle> {
  const mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });

  const audioContext = new AudioContext();
  await audioContext.resume();

  const source = audioContext.createMediaStreamSource(mediaStream);
  const processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleBuffer(input, audioContext.sampleRate, TARGET_SAMPLE_RATE);
    if (downsampled.length === 0) {
      return;
    }
    const pcm16 = floatTo16BitPCM(downsampled);
    onChunk(toArrayBuffer(pcm16));
  };

  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);

  return {
    stop: async () => {
      processor.disconnect();
      source.disconnect();
      silentGain.disconnect();
      mediaStream.getTracks().forEach((track) => track.stop());
      await audioContext.close();
    },
  };
}

export async function streamDemoAudioFile(ws: WebSocket, url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load demo audio (${response.status})`);
  }

  const audioBuffer = await response.arrayBuffer();
  const audioContext = new AudioContext();
  const decoded = await audioContext.decodeAudioData(audioBuffer.slice(0));

  const channel = decoded.getChannelData(0);
  const downsampled = downsampleBuffer(channel, decoded.sampleRate, TARGET_SAMPLE_RATE);
  const pcm16 = floatTo16BitPCM(downsampled);

  const frameSize = DEMO_FRAME_SAMPLES; // 160ms @ 16kHz (~5120 bytes)
  for (let i = 0; i < pcm16.length; i += frameSize) {
    if (ws.readyState !== WebSocket.OPEN) {
      break;
    }
    const frame = pcm16.subarray(i, i + frameSize);
    ws.send(toArrayBuffer(frame));
    const frameDurationMs = Math.max(1, Math.round((frame.length / TARGET_SAMPLE_RATE) * 1000));
    await wait(frameDurationMs);
  }

  await audioContext.close();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  const bytes = new Uint8Array(view.byteLength);
  bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  return bytes.buffer;
}

function downsampleBuffer(buffer: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (outputRate === inputRate) {
    return buffer;
  }
  if (outputRate > inputRate) {
    throw new Error("Output sample rate must be lower than input sample rate.");
  }

  const sampleRateRatio = inputRate / outputRate;
  const newLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(newLength);

  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
    let accum = 0;
    let count = 0;

    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i];
      count += 1;
    }

    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return result;
}

function floatTo16BitPCM(buffer: Float32Array): Int16Array {
  const pcm = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    const value = Math.max(-1, Math.min(1, buffer[i]));
    pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return pcm;
}
