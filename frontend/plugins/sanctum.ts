export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('sanctum:login', () => {
    // console.log('Sanctum login hook triggered', nuxtApp)
  })
  nuxtApp.hook('sanctum:logout', async () => {
    const store = useStore()
    if (store.ndisRunning) {
      await store.stopNDIS()
    }
    if (store.serviceReady) {
      await store.disconnect()
    }
  })
  nuxtApp.hook('sanctum:refresh', async () => {
    // console.log('Sanctum refresh hook triggered', nuxtApp)
  })
  nuxtApp.hook('sanctum:redirect', (url) => {
    // console.log('Sanctum redirect hook triggered', url, nuxtApp)
  })
  nuxtApp.hook('sanctum:error:request', (context) => {
    // console.log('Sanctum request error hook triggered', context, nuxtApp)
  })
  nuxtApp.hook('sanctum:error', (response) => {
    // console.log('Sanctum error hook triggered', response, nuxtApp)
  })
})