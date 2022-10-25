import EventEmitter from 'events';
import fs from 'fs';
import os from 'os';

let watch = require('fs').watch;

if (os.platform() === 'darwin') {
  // Only be used under development on macOS
  class Watcher extends EventEmitter {
    files: string[];
    timer: NodeJS.Timeout;

    constructor(private dir: string, private listener: WatchListener) {
      super();
      // TODO(kaidi.zkd): 同名文件，短时间删了再加的情况需要处理
      this.files = fs.readdirSync(this.dir);
      this.timer = setTimeout(this.interval.bind(this), 1000);
    }

    interval() {
      const { listener } = this;
      fs.readdir(this.dir, (err, files) => {
        if (err) {
          this.emit('error', err);
          this.timer = setTimeout(this.interval.bind(this), 1000);
          return;
        }

        for (const fn of files) {
          const idx = this.files.indexOf(fn);
          if (idx === -1) {
            listener('rename', fn);
          } else {
            this.files.splice(idx, 1);
          }
        }

        for (const fn of this.files) {
          listener('rename', fn);
        }

        this.files = files;
        this.timer = setTimeout(this.interval.bind(this), 1000);
      });
    }

    close() {
      if (this.timer) {
        clearInterval(this.timer);
        return;
      }
    }

    ref() {
      //
    }

    unref() {
      //
    }
  }

  watch = function (dir: string, options: any, listener: WatchListener) {
    const watcher = new Watcher(dir, listener);
    return watcher;
  }
}

type WatchListener = (eventType: string, filename: string | Buffer) => void;

module.exports = {
  watch,
};
