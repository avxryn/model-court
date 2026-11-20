// Applies the saved theme before the first paint (see src/lib/theme.ts). Same-origin, so the CSP allows it.
;(function () {
  try {
    var choice = localStorage.getItem('mc.theme')
    // No saved choice follows the system (D-120).
    var dark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  } catch (e) {
    document.documentElement.dataset.theme = 'light'
  }
  // Without a saved light or dark choice, follow the system when it changes too, on every page.
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (event) {
      var saved = null
      try {
        saved = localStorage.getItem('mc.theme')
      } catch (e) {}
      if (saved !== 'light' && saved !== 'dark') document.documentElement.dataset.theme = event.matches ? 'dark' : 'light'
    })
  } catch (e) {}
})()
