import assets from 'onda:assets';
import { handleFeedRequest } from './feed-handler.js';
import { createStaticHandler } from './static-handler.js';

const handleStaticRequest = createStaticHandler(assets);

export default {
  async fetch(request, env, ctx) {
    // This deployment needs no storage binding or request-global mutable state.
    void env; void ctx;
    if (new URL(request.url).pathname === '/api/feed') return handleFeedRequest(request);
    return handleStaticRequest(request);
  },
};
