// Type-level tests, checked by `pnpm typecheck` (tsconfig excludes *.test.ts).
import type { WrapsEmailConfig } from '@wraps.dev/email';
import { expectTypeOf } from 'vitest';
import type { WrapsSesOptions } from '../types';

type Client = NonNullable<WrapsSesOptions['client']>;

// A real SESClient fits, and so does a fake that only has `send`.
expectTypeOf<NonNullable<WrapsEmailConfig['client']>>().toExtend<Client>();
expectTypeOf<{ send: (command: { input: unknown }) => Promise<unknown> }>().toExtend<Client>();

// The declared fields still accept what `WrapsEmailConfig` does.
expectTypeOf<NonNullable<WrapsEmailConfig['credentials']>>().toExtend<
  NonNullable<WrapsSesOptions['credentials']>
>();
expectTypeOf<Omit<WrapsSesOptions, 'client' | 'credentials'>>().toEqualTypeOf<
  Pick<WrapsEmailConfig, 'region' | 'roleArn' | 'roleSessionName' | 'endpoint'>
>();

// And everything here is something `WrapsEmail` takes, so passing it on is sound
// once the client is a real one.
expectTypeOf<Omit<WrapsSesOptions, 'client'>>().toExtend<WrapsEmailConfig>();

// A misspelled key is an error, not a silently ignored option.
// @ts-expect-error: `regoin` is not an SES option
const typo: WrapsSesOptions = { regoin: 'eu-west-1' };
void typo;
