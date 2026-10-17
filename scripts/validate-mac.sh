#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcrun swiftc tests/mac/check_search.swift -o .tmp/check-search
.tmp/check-search .tmp/korean-ocr.pdf 연구 0
.tmp/check-search .tmp/korean-ocr.pdf 연구 1
.tmp/check-search .tmp/mixed-both.pdf Introduction 0
