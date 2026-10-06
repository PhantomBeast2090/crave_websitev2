import { createDb } from './harness.mjs'
const { applied } = await createDb({ withNew: false })
console.log('baseline applied:', applied.length)
