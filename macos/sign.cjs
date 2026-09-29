// electron-builder `mac.sign` hook. electron-builder's own signing skips
// Contents/PlugIns entirely, so the Quick Look extensions (macos/quicklook)
// would ship with only their ad-hoc signature and fail notarization. Sign each
// .appex with the app's identity and its own sandbox entitlements first — it
// has to be signed before the app that seals it — then sign the app as usual.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { signAsync } = require('@electron/osx-sign')

const entitlements = path.join(__dirname, 'quicklook', 'QuickLook.entitlements')

exports.default = async function sign(opts) {
  const plugins = path.join(opts.app, 'Contents', 'PlugIns')
  const appexes = fs.existsSync(plugins) ? fs.readdirSync(plugins).filter((f) => f.endsWith('.appex')) : []
  for (const appex of appexes) {
    const args = ['--force', '--sign', opts.identity, '--options', 'runtime', '--timestamp']
    if (opts.keychain) args.push('--keychain', opts.keychain)
    execFileSync('codesign', [...args, '--entitlements', entitlements, path.join(plugins, appex)], { stdio: 'inherit' })
  }
  await signAsync(opts)
}
