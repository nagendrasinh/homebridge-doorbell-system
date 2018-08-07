'use strict';

const packageJSON = require('./package.json');
const CameraSource = require('./CameraSource');

module.exports = (hap, Accessory, log) => class DoorbellAccessory extends Accessory {

    constructor (conf) {
        conf = conf || {};

        const name = conf.name || 'Pi Doorbell';
        const id = conf.id || name;
        const triggerButton = conf.button || false;

        const uuid = hap.uuid.generate('homebridge-video-doorbell-rpi:' + id);

        super(name, uuid, hap.Accessory.Categories.VIDEO_DOORBELL); // hap.Accessory.Categories.CAMERA only required for homebridge - ignored by hap-nodejs (standalone)

        this.informationService = this.getService(hap.Service.AccessoryInformation);
        this.informationService
            .setCharacteristic(hap.Characteristic.Manufacturer, "Andreas Bauer")
            .setCharacteristic(hap.Characteristic.Model, "Video Doorbell")
            .setCharacteristic(hap.Characteristic.SerialNumber, "VD01")
            .setCharacteristic(hap.Characteristic.FirmwareRevision, packageJSON.version);

        this.doorbellService = new hap.Service.Doorbell(name);
        this.doorbellService.getCharacteristic(hap.Characteristic.ProgrammableSwitchEvent)
            .on("get", DoorbellAccessory.getBellStatus.bind(this));

        this.on('identify', function (paired, callback) {
            log('**identify**');

            callback();
        }.bind(this));

        const cameraSource = new CameraSource(hap, conf, log);
        this.configureCameraSource(cameraSource);

        this.addService(this.doorbellService);

        if (triggerButton) {
            let switchService = new hap.Service.Switch(name + " Trigger");
            switchService.getCharacteristic(hap.Characteristic.On)
                .on("set", function (on, callback) {
                    if (on) {
                        setTimeout(function () {
                            switchService.setCharacteristic(hap.Characteristic.On, false);
                        }, 1000);

                        setTimeout(function () {
                            this.ringTheBell()
                        }.bind(this), 10000);
                    }

                    callback(null, on);
                }.bind(this))
                .on("get", function (callback) {
                    callback(null, false);
                }.bind(this));

            this.addService(switchService);
        }
    }

    static getBellStatus(callback) {
        callback(null, null);
    };

    ringTheBell() {
        this.doorbellService.setCharacteristic(hap.Characteristic.ProgrammableSwitchEvent, 0);
    };

};
