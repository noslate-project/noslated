import { Host } from '#self/lib/rpc/host';

async function main(argv: any[]) {
  const host = new Host(argv[0]);
  await host.start();
  process.send?.('ready');
  host.on(Host.events.NEW_CONNECTION, () => {
    process.send?.(Host.events.NEW_CONNECTION);
  });
}

main(process.argv.slice(2));
