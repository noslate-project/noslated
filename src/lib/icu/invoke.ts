import _ from 'lodash';
import arg from 'arg';
import { Guest } from '#self/lib/rpc/guest';
import { loadDescriptor } from '#self/lib/rpc/util';
import { icu, IcuError } from './_util';

async function main(argv: string[]) {
  const args = arg(
    {
      '--sock': String,
      '--service': String,
      '--include': [String],
      '--pretty': Boolean,
    },
    {
      argv,
      stopAtPositional: true,
    }
  );

  if (args['--sock'] == null) {
    throw new IcuError('use --sock <address> to set host address');
  }
  if (args['--service'] == null) {
    throw new IcuError(
      'use --service <path> to set service proto definition url'
    );
  }
  const { grpcDescriptor } = loadDescriptor(args['--include']);
  const serviceDescriptor: any = _.get(grpcDescriptor, args['--service']);
  if (serviceDescriptor == null) {
    throw new IcuError(`service '${args['--service']}' not found`);
  }
  const [method, data] = args._;
  if (!(method in serviceDescriptor.service)) {
    throw new IcuError(
      `no method named '${method}' in service '${args['--service']}'.`
    );
  }

  const guest: any = new Guest(args['--sock']);
  guest.addService(serviceDescriptor);
  await guest.start();
  const resp = await guest[method](JSON.parse(data));

  const format = args['--pretty'] ? '%o' : '%j';
  console.log(format, resp);
  await guest.close();
  // TODO(chengzhong.wcz): investigate why there are dangling handles.
  process.exit(0);
}

module.exports = main;

if (require.main === module) {
  icu(main(process.argv.slice(2)));
}
