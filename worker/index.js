// Serves the built site, and proxies Firebase Auth's helper pages (/__/auth/*,
// /__/firebase/*) so Google sign-in runs on sitescope.poschventures.com instead
// of the project's default sitescope-58fae.firebaseapp.com domain.
const FIREBASE_AUTH_HOST = 'sitescope-58fae.firebaseapp.com';

async function proxyToFirebase(request) {
  const url = new URL(request.url);
  url.protocol = 'https:';
  url.hostname = FIREBASE_AUTH_HOST;
  url.port = '';

  const headers = new Headers(request.headers);
  headers.delete('host');

  return fetch(url.toString(), {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/__/auth/') || pathname.startsWith('/__/firebase/')) {
      return proxyToFirebase(request);
    }
    return env.ASSETS.fetch(request);
  },
};
