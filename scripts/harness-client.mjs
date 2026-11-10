// Offline harness: load the browser half with stubbed React and a stub Client
// context, then run apply() so slot registration and locale setup execute.
let captured
globalThis.window = {
  __ModuleLoader__: {
    load(entry) { captured = entry },
  },
}
const styleElements = []
globalThis.document = {
  createElement() {
    return { id: '', textContent: '', remove() { const index = styleElements.indexOf(this); if (index >= 0) styleElements.splice(index, 1) } }
  },
  head: { appendChild(element) { styleElements.push(element) } },
  body: {},
  addEventListener() {},
  removeEventListener() {},
}

const React = {
  createElement: () => null,
  Fragment: 'fragment',
  useEffect() {},
  useMemo() {},
  useRef() { return { current: null } },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
}
const ReactDOM = { createPortal: value => value }

await import('../client.js')
if (!captured) throw new Error('client.js did not call __ModuleLoader__.load')
console.log('loaded module id:', captured.id)

const requireStub = spec => {
  if (spec === 'react') return React
  if (spec === 'react-dom') return ReactDOM
  return {}
}
const client = captured.factory(requireStub)
console.log('client exports:', Object.keys(client).join(','), '| inject:', client.inject.join(','))

const registrations = []
const ctx = {
  locale: {
    register() { return () => {} },
    bind() { return (key, params) => key },
  },
  connection: {
    rpc: {
      async call() { throw new Error('no host in harness') },
    },
  },
  slots: {
    inject(name, callback) { console.log('slot inject:', name); callback(); return () => {} },
    register(options, component) { registrations.push({ options, component }); return () => {} },
  },
  effect(callback) { callback() },
}

client.apply(ctx)
console.log('registrations:', registrations.map(item => `${item.options.name}#${item.options.id}`).join(','))
console.log('injected props keys:', Object.keys(registrations[0].options.inject() || {}).join(','))
console.log('styles inserted:', styleElements.length)
console.log('client harness ok')
