// The fake Jev API as a standalone server for end-to-end tests.
import { startFakeJev } from '../support/fake-jev.ts';

const jev = await startFakeJev(Number(process.env.FAKE_JEV_PORT ?? 5198));
console.log(`fake Jev listening on ${jev.url}`);
process.on('SIGTERM', () => jev.close().then(() => process.exit(0)));
