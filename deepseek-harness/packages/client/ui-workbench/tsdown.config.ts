import { dirname, resolve } from 'node:path'
import { pdfBundle } from './pdf-bundle.ts'
import { clientBundle } from '../tsdown.client.ts'

const bundle = clientBundle('@deepseek-ai/dsh-client-ui-workbench', ['lib/types/index.js'])

export default (options: Parameters<typeof bundle>[0]) => bundle(options).map(config => {
  if (config.platform !== 'browser') return config
  return {
    ...config,
    banner: pdfBundle.banner,
    outputOptions: { ...config.outputOptions, inlineDynamicImports: true },
    define: { ...config.define, ...pdfBundle.define },
    plugins: [{
      name: 'workbench-vfile-browser',
      resolveId: {
        order: 'pre' as const,
        handler(source: string, importer: string | undefined) {
          // VFile package-private imports must use their browser implementations.
          if (importer?.endsWith('/vfile/lib/index.js') && /^#min(path|proc|url)$/.test(source)) {
            return resolve(dirname(importer), `${source.slice(1)}.browser.js`)
          }
          return null
        },
      },
    }, ...[config.plugins ?? []].flat(), ...pdfBundle.plugins],
  }
})
