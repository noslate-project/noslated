import arg from 'arg';
import { Guest } from '#self/lib/rpc/guest';
import { icu, IcuError } from './_util';

async function main(argv: string[]) {
  const args = arg({
    '--sock': String,
  }, {
    argv,
  });

  if (args['--sock'] == null) {
    throw new IcuError('use --sock <address> to set host address');
  }

  const guest = new Guest(args['--sock']);
  await guest.start();
  args._.forEach(event => {
    guest.subscribe(event, (msg: any, packed: { toObject: () => any; }) => {
      console.log('[%s] %s: %j', new Date(), event, packed.toObject());
    });
  });
}

module.exports = main;

if (require.main === module) {
  icu(main(process.argv.slice(2)));
}
