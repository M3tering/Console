/* Compatibility boundary for ChirpStack v4's root-based gRPC-Web client. */
(function () {
  'use strict';
  if (!location.pathname.startsWith('/chirpstack/')) return;
  // Central serves each target under its own path (/chirpstack/~GATEWAY_ID/), so two
  // tabs can show two ChirpStacks; standalone uses /chirpstack/.
  const scope = /^\/chirpstack\/~([\w-]{1,64})\//.exec(location.pathname);
  const base = scope ? `/chirpstack/~${scope[1]}` : '/chirpstack';
  function proxied(value) {
    const url = new URL(String(value), location.href);
    if (url.origin === location.origin && !url.pathname.startsWith(base + '/')) {
      url.pathname = base + (url.pathname.startsWith('/chirpstack/') ? url.pathname.slice('/chirpstack'.length) : url.pathname);
    }
    return url.href;
  }
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    return open.call(this, method, proxied(url), ...args);
  };
  const fetch = window.fetch;
  window.fetch = function (input, options) {
    return fetch.call(this, input instanceof Request ? new Request(proxied(input.url), input) : proxied(input), options);
  };
  // Bundlers construct some lazy CSS/script URLs at runtime, after HTML rewriting.
  // Map them before the browser starts loading; leave hash-router anchors alone.
  const resources = [[HTMLImageElement, 'src'], [HTMLScriptElement, 'src'], [HTMLLinkElement, 'href']];
  for (const [Type, property] of resources) {
    const descriptor = Object.getOwnPropertyDescriptor(Type.prototype, property);
    if (descriptor?.set) Object.defineProperty(Type.prototype, property, {
      ...descriptor, set(value) { descriptor.set.call(this, proxied(value)); },
    });
  }
  const setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const resource = resources.some(([Type, property]) => this instanceof Type && name.toLowerCase() === property);
    return setAttribute.call(this, name, resource ? proxied(value) : value);
  };
  // ChirpStack clears localStorage on logout. Keep console preferences intact.
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const storage = window[name];
      // Each target keeps its own ChirpStack login: one gateway's token never reaches another.
      const prefix = scope ? `m3tering.chirpstack.${scope[1]}.` : 'm3tering.chirpstack.';
      const keys = () => Object.keys(storage).filter(key => key.startsWith(prefix));
      const scoped = {
        get length() { return keys().length; },
        key(index) { return keys()[index]?.slice(prefix.length) ?? null; },
        getItem(key) { return storage.getItem(prefix + key); },
        setItem(key, value) { storage.setItem(prefix + key, value); },
        removeItem(key) { storage.removeItem(prefix + key); },
        clear() { keys().forEach(key => storage.removeItem(key)); },
      };
      Object.defineProperty(window, name, { value: scoped });
    } catch { /* Browser storage restrictions are handled by the upstream UI. */ }
  }
})();
