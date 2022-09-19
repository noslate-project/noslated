import { Host } from '#self/lib/rpc/host';

async function main(argv: any[]) {
  const host = new Host(argv[0]);
  host._livenessProbe = () => {};
  await host.start();
  process.send?.('ready');
}

main(process.argv.slice(2));
