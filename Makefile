BUILDTYPE ?= Release
.PHONY: all
all: tsc

include ../build/Makefiles/toolchain.mk

src/proto/root.d.ts: proto/noslated/*.proto ../aworker/src/proto/*.proto tools/proto2ts.sh
	bash tools/proto2ts.sh

test-proto:
	bash tools/test_proto2ts.sh

src/lib/json/inspector_protocol.json:
	$(MAKE) -C $(BUILD_PROJ_DIR) configure
	ninja -C $(BUILD_PROJ_DIR)/out/$(BUILDTYPE) $(NINJA_PARAMS) copy_aworker_inspector_json

.PHONY: tsc
tsc: node_modules src/proto/root.d.ts src/lib/json/inspector_protocol.json
	$(TOOLCHAIN_NPM_BIN) run build

.PHONY: tsc-test
tsc-test: tsc node_modules src/proto/root.d.ts test-proto src/lib/json/inspector_protocol.json
	$(TOOLCHAIN_NPM_BIN) run build-test

.PHONY: build
build: tsc
	$(MAKE) -C $(BUILD_PROJ_DIR) noslate turf
	rm -f .turf/runtime/nodejs/node; ln -s $(BUILD_PROJ_DIR)/out/$(BUILDTYPE)/node .turf/runtime/nodejs/node
	rm -f .turf/runtime/aworker/aworker; ln -s $(BUILD_PROJ_DIR)/out/$(BUILDTYPE)/aworker .turf/runtime/aworker/aworker

node_modules: package.json
	$(TOOLCHAIN_NPM_BIN) install
	@touch $@

.PHONY: lint
lint: jslint

.PHONY: jslint
jslint: $(BUILD_NODE_MODULES) node_modules
	$(ESLINT) --report-unused-disable-directives .

.PHONY: jsformat
jsformat: $(BUILD_NODE_MODULES) node_modules
	$(ESLINT) --report-unused-disable-directives --fix .

.PHONY: test sanitytest
test: jstest benchmarktest
sanitytest:

TURF_TEST_WORKDIR=$(shell pwd)/.turf
.PHONY: jstest
jstest: export TURF_WORKDIR=$(TURF_TEST_WORKDIR)
jstest: tsc-test build clean-test node_modules
ifeq ($(BUILDTYPE), Debug)
jstest: export PATH:=$(BUILD_PROJ_DIR)/out/Debug:$(PATH)
jstest: export NATIVE_DEBUG=1
jstest: export NOSLATED_LOG_LEVEL=Debug
jstest: export NOSLATED_SOCK_CONN_TIMEOUT=30000
else
jstest: export PATH:=$(BUILD_PROJ_DIR)/out/Release:$(PATH)
endif
ifeq ($(V), 1)
jstest: export GRPC_TRACE=all
jstest: export GRPC_VERBOSITY=DEBUG
endif
jstest: export NOSLATED_LOG_CONSOLE=true
jstest:
	npm run cov -- $(JSTEST_FLAGS)

.PHONY: baselinetest
baselinetest: export TURF_WORKDIR=$(TURF_TEST_WORKDIR)
baselinetest: build node_modules clean-test
ifeq ($(BUILDTYPE), Debug)
baselinetest: export PATH:=$(BUILD_PROJ_DIR)/out/Debug:$(PATH)
baselinetest: export NATIVE_DEBUG=1
baselinetest: export NOSLATED_LOG_LEVEL=Debug
baselinetest: export NOSLATED_SOCK_CONN_TIMEOUT=30000
else
baselinetest: export PATH:=$(BUILD_PROJ_DIR)/out/Release:$(PATH)
endif
baselinetest: export NOSLATED_LOG_CONSOLE=true
baselinetest: export PATH:=$(shell pwd)/node_modules/.bin:$(PATH)
baselinetest:
	npm run test -- -g 'baseline'

.PHONY: benchmarktest
benchmarktest: export TURF_WORKDIR=$(TURF_TEST_WORKDIR)
ifeq ($(BUILDTYPE), Debug)
benchmarktest: export PATH:=$(BUILD_PROJ_DIR)/out/Debug:$(PATH)
benchmarktest: export NATIVE_DEBUG=1
else
benchmarktest: export PATH:=$(BUILD_PROJ_DIR)/out/Release:$(PATH)
endif
benchmarktest: export NOSLATED_LOG_CONSOLE=true
benchmarktest: export PATH:=$(shell pwd)/node_modules/.bin:$(PATH)
benchmarktest: build node_modules clean-test
	node benchmark/run test all

.PHONY: benchmark
benchmark: export TURF_WORKDIR=$(TURF_TEST_WORKDIR)
benchmark: build node_modules clean-test
	node benchmark/run --format csv all

.PHONY: clean
clean:
	rm -rf build
	rm -rf src/proto/*

.PHONY: clean-test
clean-test: export TURF_WORKDIR=$(TURF_TEST_WORKDIR)
clean-test: node_modules
	rm -rf .code/bundles/*
	rm -rf .code/caches/*
	rm -rf .code/socks/*
	rm -rf .code/logs/*
	rm -rf .code/logs/.*-audit.json
	rm -rf $(TURF_TEST_WORKDIR)/overlay/*
	rm -rf $(TURF_TEST_WORKDIR)/sandbox/*
