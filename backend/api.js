const app = require('./server');

let readyPromise;

function getReadyPromise() {
  if (!readyPromise) {
    readyPromise = app.ready();
  }

  return readyPromise;
}

function stripBackendMountPath(url = '/') {
  const normalized = String(url || '/')
    .replace(/^\/_\/backend(?=\/|$)/, '')
    .replace(/^\/api\/backend(?=\/|$)/, '');

  if (!normalized || normalized === '?') {
    return '/';
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

module.exports = async function backendHandler(req, res) {
  await getReadyPromise();
  req.url = stripBackendMountPath(req.url);
  app.server.emit('request', req, res);
};
