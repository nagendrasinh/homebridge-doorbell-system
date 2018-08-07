'use strict'
const minimist = require('minimist')
const hap = require('hap-nodejs')
const DoorbellAccessory = require('./DoorbellAccessory')(hap, hap.Accessory, console.log)

let conf = {}
const argv = minimist(process.argv.slice(2))
const configFile = argv['c'] || argv['config']
if (configFile) {
  try {
    conf = require(configFile)
  } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') { throw e } }
}

console.log('HAP-NodeJS starting...')

hap.init()

const doorbellAccessory = new DoorbellAccessory(conf)

const pincode = conf.pincode || '031-45-154'

doorbellAccessory.publish({
  username: conf.username || 'EC:23:3D:D3:CE:CE',
  pincode: pincode,
  category: hap.Accessory.Categories.VIDEO_DOORBELL
}, true)

console.log('Scan this code with your HomeKit App on your iOS device to pair with Doorbell:')
console.log('                       ')
console.log('    ┌────────────┐     ')
console.log(`    │ ${pincode} │     `)
console.log('    └────────────┘     ')
console.log('                       ')
