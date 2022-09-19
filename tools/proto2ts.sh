#!/usr/bin/env bash

set -ex

PBJS=`npx -c "which pbjs"`
PBTS=`npx -c "which pbts"`
TS_PROTO=`npx -c "which protoc-gen-ts_proto"`

PROTO_FILES=`find ./proto -type f -name '*.proto'`
out="src/proto/root.d.ts"
mkdir -p `dirname $out`
$PBJS -t static-module -w commonjs --null-defaults --keep-case $PROTO_FILES | $PBTS -o "$out" -
node -e "fs.writeFileSync('$out', '/* eslint-disable */\n' + fs.readFileSync('src/proto/root.d.ts', 'utf8'), 'utf8');"

# aworker proto files
PROTO_FILES=`find ../aworker/src/proto -type f -name '*.proto'`
out="src/proto/aworker"
mkdir -p `dirname $out`
$PBJS -t static-module -w commonjs --null-defaults $PROTO_FILES -o "$out.js"
$PBTS -o "$out.d.ts" "$out.js"
