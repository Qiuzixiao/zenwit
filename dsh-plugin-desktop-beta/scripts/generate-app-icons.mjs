import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { generateMacAppIcon } from './generate-mac-app-icon.mjs'

const source = await readFile(new URL('../build/zenwit-icon.svg', import.meta.url))
await sharp(source).resize(1024, 1024).withIccProfile('srgb').toColourspace('rgb16').png()
  .toFile(new URL('../build/app-icon.png', import.meta.url).pathname)
await generateMacAppIcon()
