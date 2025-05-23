import { createTRPCClient, httpBatchLink, httpLink, splitLink, httpBatchStreamLink } from '@trpc/client';
import type { AppRouter } from '../../../server/routerTrpc/_app';
import superjson from 'superjson';
import { getBlinkoEndpoint } from './blinkoEndpoint';
import { RootStore } from '@/store';
import { UserStore } from '@/store/user';
const headers = () => {
  const userStore = RootStore.Get(UserStore);
  const token = userStore.token;
  const baseHeaders: Record<string, string> = {};

  if (token) {
    baseHeaders['Authorization'] = `Bearer ${token}`;
  }

  return baseHeaders;
};


const getLinks = (useStream = false) => {
  try {
    if (useStream) {
      return httpBatchStreamLink({
        url: getBlinkoEndpoint('/api/trpc'),
        transformer: superjson,
        headers
      });
    }

    return splitLink({
      condition(op) {
        return op.context.skipBatch === true;
      },
      true: httpLink({
        url: getBlinkoEndpoint('/api/trpc'),
        transformer: superjson,
        headers
      }),
      // when condition is false, use batching
      false: httpBatchLink({
        url: getBlinkoEndpoint('/api/trpc'),
        transformer: superjson,
        headers
      }),
    });
  } catch (error) {
    console.error(error, 'trpc get links error');
    return splitLink({
      condition(op) {
        return op.context.skipBatch === true;
      },
      true: httpLink({
        url: ('/api/trpc'),
        transformer: superjson,
        headers
      }),
      // when condition is false, use batching
      false: httpBatchLink({
        url: ('/api/trpc'),
        transformer: superjson,
        headers
      }),
    });;
  }
};

//@ts-ignore
export let api = createTRPCClient<AppRouter>({
  links: [getLinks(false)],
});

//@ts-ignore
export let streamApi = createTRPCClient<AppRouter>({
  links: [getLinks(true)],
});

/**
 * refresh api
 * when need refresh auth status (login/logout)
 */
export const reinitializeTrpcApi = () => {
  //@ts-ignore
  api = createTRPCClient<AppRouter>({
    links: [getLinks(false)],
  });

  //@ts-ignore
  streamApi = createTRPCClient<AppRouter>({
    links: [getLinks(true)],
  });

  return { api, streamApi };
};

