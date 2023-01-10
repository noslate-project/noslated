'use strict';

const child_process = require('child_process');
const http_benchmarkers = require('./_http-benchmarkers.js');

class Benchmark {
  constructor(fn, configs, options = {}) {
    // Used to make sure a benchmark only start a timer once
    this._started = false;

    // Indicate that the benchmark ended
    this._ended = false;

    // Holds process.hrtime value
    this._time = [0, 0];

    // Use the file name as the name of the benchmark
    this.name = require.main.filename.slice(__dirname.length + 1);

    // Execution arguments i.e. flags used to run the jobs
    this.flags = process.env.NODE_BENCHMARK_FLAGS
      ? process.env.NODE_BENCHMARK_FLAGS.split(/\s+/)
      : [];

    // Parse job-specific configuration from the command line arguments
    const argv = process.argv.slice(2);
    const parsed_args = this._parseArgs(argv, configs, options);
    this.options = parsed_args.cli;
    this.extra_options = parsed_args.extra;
    if (options.flags) {
      this.flags = this.flags.concat(options.flags);
    }

    // The configuration list as a queue of jobs
    this.queue = this._queue(this.options);

    // The configuration of the current job, head of the queue
    this.config = this.queue[0];

    process.nextTick(() => {
      if (Object.hasOwn(process.env, 'NODE_RUN_BENCHMARK_FN')) {
        fn(this.config);
      } else {
        // _run will use fork() to create a new process for each configuration
        // combination.
        this._run();
      }
    });
  }

  _parseArgs(argv, configs, options) {
    const cliOptions = {};

    // Check for the test mode first.
    const testIndex = argv.indexOf('--test');
    if (testIndex !== -1) {
      for (const [key, rawValue] of Object.entries(configs)) {
        let value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
        // Set numbers to one by default to reduce the runtime.
        if (typeof value === 'number') {
          if (key === 'dur' || key === 'duration') {
            value = 0.05;
          } else if (value > 1) {
            value = 1;
          }
        }
        cliOptions[key] = [value];
      }
      // Override specific test options.
      if (options.test) {
        for (const [key, value] of Object.entries(options.test)) {
          cliOptions[key] = Array.isArray(value) ? value : [value];
        }
      }
      argv.splice(testIndex, 1);
    } else {
      // Accept single values instead of arrays.
      for (const [key, value] of Object.entries(configs)) {
        if (!Array.isArray(value)) {
          configs[key] = [value];
        }
      }
    }

    const extraOptions = {};
    const validArgRE = /^(.+?)=([\s\S]*)$/;
    // Parse configuration arguments
    for (const arg of argv) {
      const match = arg.match(validArgRE);
      if (!match) {
        console.error(`bad argument: ${arg}`);
        process.exit(1);
      }
      const [, key, value] = match;
      if (Object.prototype.hasOwnProperty.call(configs, key)) {
        if (!cliOptions[key]) {
          cliOptions[key] = [];
        }
        cliOptions[key].push(
          // Infer the type from the config object and parse accordingly
          typeof configs[key][0] === 'number' ? +value : value
        );
      } else {
        extraOptions[key] = value;
      }
    }
    return { cli: { ...configs, ...cliOptions }, extra: extraOptions };
  }

  _queue(options) {
    const queue = [];
    const keys = Object.keys(options);

    // Perform a depth-first walk through all options to generate a
    // configuration list that contains all combinations.
    function recursive(keyIndex, prevConfig) {
      const key = keys[keyIndex];
      const values = options[key];

      for (const value of values) {
        if (typeof value !== 'number' && typeof value !== 'string') {
          throw new TypeError(
            `configuration "${key}" had type ${typeof value}`
          );
        }
        if (typeof value !== typeof values[0]) {
          // This is a requirement for being able to consistently and
          // predictably parse CLI provided configuration values.
          throw new TypeError(`configuration "${key}" has mixed types`);
        }

        const currConfig = { [key]: value, ...prevConfig };

        if (keyIndex + 1 < keys.length) {
          recursive(keyIndex + 1, currConfig);
        } else {
          queue.push(currConfig);
        }
      }
    }

    if (keys.length > 0) {
      recursive(0, {});
    } else {
      queue.push({});
    }

    return queue;
  }

  http(options, cb) {
    const http_options = { ...options };
    http_options.benchmarker =
      http_options.benchmarker ||
      this.config.benchmarker ||
      this.extra_options.benchmarker ||
      http_benchmarkers.default_http_benchmarker;
    http_benchmarkers.run(
      http_options,
      (error, code, used_benchmarker, result, elapsed) => {
        if (cb) {
          cb(code);
        }
        if (error) {
          console.error(error);
          process.exit(code || 1);
        }
        this.config.benchmarker = used_benchmarker;
        this.report(result, elapsed);
      }
    );
  }

  _run() {
    // If forked, report to the parent.
    if (process.send) {
      process.send({
        type: 'config',
        name: this.name,
        queueLength: this.queue.length,
      });
    }

    const recursive = queueIndex => {
      const config = this.queue[queueIndex];

      // Set NODE_RUN_BENCHMARK_FN to indicate that the child shouldn't
      // construct a configuration queue, but just execute the benchmark
      // function.
      const childEnv = { ...process.env };
      childEnv.NODE_RUN_BENCHMARK_FN = '';

      // Create configuration arguments
      const childArgs = [];
      for (const [key, value] of Object.entries(config)) {
        childArgs.push(`${key}=${value}`);
      }
      for (const [key, value] of Object.entries(this.extra_options)) {
        childArgs.push(`${key}=${value}`);
      }

      const child = child_process.fork(require.main.filename, childArgs, {
        env: childEnv,
        execArgv: this.flags.concat(process.execArgv),
      });
      child.on('message', sendResult);
      child.on('close', (code, signal) => {
        if (signal) {
          process.kill(process.pid, signal);
          return;
        }
        if (code) {
          return process.exit(code);
        }

        if (queueIndex + 1 < this.queue.length) {
          recursive(queueIndex + 1);
        }
      });
    };

    recursive(0);
  }

  start() {
    if (this._started) {
      throw new Error('Called start more than once in a single benchmark');
    }
    this._started = true;
    this._time = process.hrtime();
  }

  end(operations) {
    // Get elapsed time now and do error checking later for accuracy.
    const elapsed = process.hrtime(this._time);

    if (!this._started) {
      throw new Error('called end without start');
    }
    if (this._ended) {
      throw new Error('called end multiple times');
    }
    if (typeof operations !== 'number') {
      throw new Error('called end() without specifying operation count');
    }
    if (!process.env.NODEJS_BENCHMARK_ZERO_ALLOWED && operations <= 0) {
      throw new Error('called end() with operation count <= 0');
    }
    if (elapsed[0] === 0 && elapsed[1] === 0) {
      if (!process.env.NODEJS_BENCHMARK_ZERO_ALLOWED) {
        throw new Error('insufficient clock precision for short benchmark');
      }
      // Avoid dividing by zero
      elapsed[1] = 1;
    }

    this._ended = true;
    const time = elapsed[0] + elapsed[1] / 1e9;
    const rate = operations / time;
    this.report(rate, elapsed);
  }

  report(rate, elapsed) {
    sendResult({
      name: this.name,
      conf: this.config,
      rate,
      time: elapsed[0] + elapsed[1] / 1e9,
      type: 'report',
    });
  }
}

function formatResult(data) {
  // Construct configuration string, " A=a, B=b, ..."
  let conf = '';
  for (const key of Object.keys(data.conf)) {
    conf += ` ${key}=${JSON.stringify(data.conf[key])}`;
  }

  let rate = data.rate.toString().split('.');
  rate[0] = rate[0].replace(/(\d)(?=(?:\d\d\d)+(?!\d))/g, '$1,');
  rate = rate[1] ? rate.join('.') : rate[0];
  return `${data.name}${conf}: ${rate}`;
}

function sendResult(data) {
  if (process.send) {
    // If forked, report by process send
    process.send(data);
  } else {
    // Otherwise report by stdout
    console.log(formatResult(data));
  }
}

module.exports = {
  Benchmark,
  PORT: http_benchmarkers.PORT,
  buildType: process.features.debug ? 'Debug' : 'Release',
  createBenchmark(fn, configs, options) {
    return new Benchmark(fn, configs, options);
  },
  sendResult,
};
