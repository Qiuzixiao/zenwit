import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const artifact = new URL('../lib/client.js', import.meta.url)
const registrations = []
const window = {
  __ModuleLoader__: {
    load(registration) {
      registrations.push(registration)
    },
  },
}

runInNewContext(readFileSync(artifact, 'utf8'), { window }, {
  filename: artifact.pathname,
})

if (registrations.length !== 1) {
  throw new Error(`market client registered ${String(registrations.length)} Loader modules`)
}
const [registration] = registrations
if (registration?.id !== 'dsh-community-market' || typeof registration.factory !== 'function') {
  throw new Error('market client did not register the expected Loader module')
}

const requestedModules = new Set()
registration.factory((specifier) => {
  requestedModules.add(specifier)
  return {}
})
// The market renders through the shared primitives library; requesting them is what
// proves the artifact links against the platform instead of carrying its own copy.
// Store state left this package with the sidebar launcher, and any store it adds back
// must likewise arrive through the platform module (verify-client-packages owns that).
if (!requestedModules.has('@deepseek-ai/dsh-client-ui-primitives')) {
  throw new Error('market client bundled private primitives instead of using the alpha platform module')
}
if (requestedModules.has('@deepseek-ai/dsh-client-runtime/client')) {
  throw new Error('market client still requests the removed legacy client runtime')
}

process.stdout.write('verify-market-client-loader: dsh-community-market registered one client module\n')
