#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != 'Darwin' || "$(uname -m)" != 'x86_64' ]]; then
  echo 'Run this script on an Intel macOS runner.' >&2
  exit 1
fi

: "${RUNNER_TEMP:?RUNNER_TEMP must point to the GitHub Actions temporary directory}"
onnx_source="$RUNNER_TEMP/onnxruntime-source"
onnx_build="$RUNNER_TEMP/onnxruntime-build"
onnx_tools="$RUNNER_TEMP/onnxruntime-tools"

# Match the ONNX Runtime version used by ort 2.0.0-rc.12 on the other targets.
git clone --branch v1.24.2 --depth 1 --recurse-submodules --shallow-submodules \
  https://github.com/microsoft/onnxruntime.git "$onnx_source"
python3 -m venv "$onnx_tools"
"$onnx_tools/bin/python" -m pip install 'cmake>=3.28,<4' packaging numpy flatbuffers

cd "$onnx_source"
# Without --build_shared_lib, ort can link the resulting static archives.
"$onnx_tools/bin/python" tools/ci_build/build.py \
  --config Release \
  --build_dir "$onnx_build" \
  --cmake_path "$onnx_tools/bin/cmake" \
  --parallel 3 \
  --skip_tests \
  --compile_no_warning_as_error \
  --cmake_extra_defines \
    CMAKE_OSX_ARCHITECTURES=x86_64 \
    CMAKE_OSX_DEPLOYMENT_TARGET=13.3 \
    onnxruntime_BUILD_UNIT_TESTS=OFF

test -f "$onnx_build/Release/libonnxruntime_session.a"
