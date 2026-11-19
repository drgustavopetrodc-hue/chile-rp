import type { StoreIdentidad } from './types.js'

let storeCompartido: Promise<StoreIdentidad> | undefined

export function resolverStoreIdentidad(store?: StoreIdentidad): Promise<StoreIdentidad> {
  if (store) return Promise.resolve(store)
  storeCompartido ??= Promise.all([
    import('@rp-chile/db'),
    import('./adapters/prisma.js'),
  ]).then(([{ db }, { crearStoreIdentidad }]) => crearStoreIdentidad(db))
  return storeCompartido
}
