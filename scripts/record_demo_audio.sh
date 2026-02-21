#!/usr/bin/env bash
set -euo pipefail

# Record a mono 16kHz PCM WAV file suitable for Smallest STT demo testing.
#
# Usage:
#   ./scripts/record_demo_audio.sh [output_path] [duration_seconds] [audio_device_index]
#
# Examples:
#   ./scripts/record_demo_audio.sh
#   ./scripts/record_demo_audio.sh client/public/demo/demo-conversation.wav 35 0

OUTPUT_PATH="${1:-client/public/demo/demo-conversation.wav}"
DURATION_SECONDS="${2:-35}"
AUDIO_DEVICE_INDEX="${3:-0}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required but not found."
  echo "Install on macOS: brew install ffmpeg"
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_PATH}")"

echo "Recording ${DURATION_SECONDS}s from macOS audio input index ${AUDIO_DEVICE_INDEX}..."
echo "Output: ${OUTPUT_PATH}"
echo "Speak now. Press Ctrl+C to stop early."

ffmpeg \
  -hide_banner \
  -loglevel warning \
  -f avfoundation \
  -i ":${AUDIO_DEVICE_INDEX}" \
  -t "${DURATION_SECONDS}" \
  -ac 1 \
  -ar 16000 \
  -sample_fmt s16 \
  -y "${OUTPUT_PATH}"

echo "Saved demo audio to ${OUTPUT_PATH}"
