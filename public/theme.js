// Applies the saved theme before the first paint (see src/lib/theme.ts). Same-origin, so the CSP allows it.
;(function () {
  try {
    var choice = localStorage.getItem('mc.theme')
    var dark = choice === 'dark' || (choice === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  } catch (e) {
    document.documentElement.dataset.theme = 'light'
  }
})()
