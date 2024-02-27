import arg from 'arg';
import { Guest } from '#self/lib/rpc/guest';
import { getSockAddr, icu, IcuError } from './_util';

async function main(argv: string[]) {
  const args = arg(
    {
      '--sock': String,
      '--service': String,
    },
    {
      argv,
    }
  );

  let sockAddr = args['--sock'];
  if (sockAddr == null && args['--service']) {
    sockAddr = getSockAddr(args['--service']);
  }
  if (sockAddr == null) {
    throw new IcuError('use --sock <address> to set host address');
  }
  if (sockAddr.startsWith('/')) {
    sockAddr = `unix://${sockAddr}`;
  }

  const guest = new Guest(sockAddr);
  await guest.start();
  args._.forEach(event => {
    guest.subscribe(event, (msg: any, packed: { toObject: () => any }) => {
      console.log('[%s] %s: %j', new Date(), event, packed.toObject());
    });
  });
}

module.exports = main;

if (require.main === module) {
  icu(main(process.argv.slice(2)));
}
