'use strict';

let Accessory, hap;

module.exports = function (homebridge) {
    Accessory = homebridge.platformAccessory;
    hap = homebridge.hap;

    homebridge.registerPlatform('homebridge-video-doorbell-rpi', 'rpi-doorbell', Platform, true);
};

function Platform (log, config, api) {
    this.CameraAccessory = require('./DoorbellAccessory')(hap, Accessory, log, api);
    this.config = config || {};
    this.api = api;

    if (!api || api.version < 2.1)
        throw new Error('Unexpected API version.');

    api.on('didFinishLaunching', this.didFinishLaunching.bind(this));
}

Platform.prototype.configureAccessory = function (accessory) {};

Platform.prototype.didFinishLaunching = function () {
    if (!this.config.devices)
        return;

    const configuredAccessories = this.config.devices.map(conf => new this.CameraAccessory(conf));

    this.api.publishCameraAccessories('rpi-doorbell', configuredAccessories);
};
