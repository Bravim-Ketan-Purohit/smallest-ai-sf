#!/usr/bin/env bash
set -euo pipefail

# Upload a local audio file to Smallest pre-recorded STT endpoint.
#
# Usage:
#   ./scripts/upload_demo_to_smallest.sh [audio_path] [language]
#
# Examples:
#   ./scripts/upload_demo_to_smallest.sh
#   ./scripts/upload_demo_to_smallest.sh server/demo_conv.mp3 en
#   ./scripts/upload_demo_to_smallest.sh client/public/demo/demo-conversation.wav en

if [[ $# -ge 1 ]]; then
  AUDIO_PATH="$1"
elif [[ -f "server/demo_conv.mp3" ]]; then
  AUDIO_PATH="server/demo_conv.mp3"
elif [[ -f "client/public/demo/demo-conversation.mp3" ]]; then
  AUDIO_PATH="client/public/demo/demo-conversation.mp3"
else
  AUDIO_PATH="client/public/demo/demo-conversation.wav"
fi

LANGUAGE="${2:-en}"

if [[ -f "server/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "server/.env"
  set +a
fi

if [[ -z "${SMALLEST_API_KEY:-}" ]]; then
  echo "SMALLEST_API_KEY is not set."
  echo "Set it in your shell or in server/.env."
  exit 1
fi

if [[ ! -f "${AUDIO_PATH}" ]]; then
  echo "Audio file not found: ${AUDIO_PATH}"
  exit 1
fi

lower_name="$(echo "${AUDIO_PATH}" | tr '[:upper:]' '[:lower:]')"
if [[ "${lower_name}" == *.mp3 ]]; then
  CONTENT_TYPE="audio/mpeg"
elif [[ "${lower_name}" == *.wav ]]; then
  CONTENT_TYPE="audio/wav"
elif [[ "${lower_name}" == *.flac ]]; then
  CONTENT_TYPE="audio/flac"
elif [[ "${lower_name}" == *.m4a ]] || [[ "${lower_name}" == *.mp4 ]]; then
  CONTENT_TYPE="audio/mp4"
else
  CONTENT_TYPE="application/octet-stream"
fi

URL="https://waves-api.smallest.ai/api/v1/pulse/get_text?model=pulse&language=${LANGUAGE}&word_timestamps=true"

echo "Uploading ${AUDIO_PATH} to Smallest STT..."
echo "Content-Type: ${CONTENT_TYPE}"

curl --fail-with-body \
  --request POST \
  --url "${URL}" \
  --header "Authorization: Bearer ${SMALLEST_API_KEY}" \
  --header "Content-Type: ${CONTENT_TYPE}" \
  --data-binary "@${AUDIO_PATH}"

echo
echo "Upload complete."
