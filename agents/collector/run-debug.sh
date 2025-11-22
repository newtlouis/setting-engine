#!/bin/bash
cd "$(dirname "$0")/.."
node agents/collector/debug-comments.js "$@"
