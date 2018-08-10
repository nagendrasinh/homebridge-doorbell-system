'use strict';

const packageJSON = require('./package.json');
const CameraSource = require('./CameraSource');
const rpio = require("rpio");

/*
 * Lock states
 */
const LockState = Object.freeze(
    {
        UNSECURED: 0,
        SECURED: 1,
        JAMMED: 2,
        UNKNOWN: 3
    }
);

module.exports = (hap, Accessory, log, api) => class DoorbellAccessory extends Accessory {

    constructor (config) {
        config = config || {};

        const name = config.name || 'Pi Doorbell';
        const id = config.id || name;

        const uuid = hap.uuid.generate('homebridge-video-doorbell-rpi:' + id);

        super(name, uuid, hap.Accessory.Categories.VIDEO_DOORBELL); // hap.Accessory.Categories.CAMERA only required for homebridge - ignored by hap-nodejs (standalone)
        this.log = log;

        this.informationService = this.getService(hap.Service.AccessoryInformation);
        this.informationService
            .setCharacteristic(hap.Characteristic.Manufacturer, "Andreas Bauer")
            .setCharacteristic(hap.Characteristic.Model, "Doorbell System")
            .setCharacteristic(hap.Characteristic.SerialNumber, "DS01")
            .setCharacteristic(hap.Characteristic.FirmwareRevision, packageJSON.version);

        this.doorbellService = new hap.Service.Doorbell(name);
        this.doorbellService.getCharacteristic(hap.Characteristic.ProgrammableSwitchEvent)
            .on("get", DoorbellAccessory.getBellStatus.bind(this));

        this.on('identify', (paired, callback) => {
            log('**identify**');

            callback();
        });

        const cameraSource = new CameraSource(hap, config, log);
        this.configureCameraSource(cameraSource);

        this.addService(this.doorbellService);

        if (config.triggerButton) {
            let switchService = new hap.Service.Switch(name + " Trigger");
            switchService.getCharacteristic(hap.Characteristic.On)
                .on("set", (on, callback) => {
                    if (on) {
                        setTimeout(() => {
                            switchService.setCharacteristic(hap.Characteristic.On, false);
                        }, 1000);

                        setTimeout(() => {
                            this.ringTheBell()
                        }, 10000);
                    }

                    callback(null, on);
                })
                .on("get", callback => {
                    callback(null, false);
                });

            this.addService(switchService);
        }

        if (config.lock && config.lock.pin) {
            this.lockState = 1;

            this.lockName = config.lock.name || "Lock";
            this.lockPin = config.lock.pin;
            this.unlockTime = config.lock.unlockTime || 5000;

            this.lockService = new hap.Service.LockMechanism(this.lockName);
            this.lockService.getCharacteristic(hap.Characteristic.LockCurrentState)
                .on("get", this.getLockState.bind(this));
            this.lockService.getCharacteristic(hap.Characteristic.LockTargetState)
                .on("get", this.getLockState.bind(this))
                .on("set", this.setLockState.bind(this));

            rpio.open(this.lockPin, rpio.OUTPUT, rpio.LOW);

            api.on('shutdown', () => {
                rpio.close(this.lockPin);
            });

            this.addService(this.lockService);
        }

        if (config.ringButton) {
            config.ringButton.map(configuration => {
                const gpioPin = configuration.gpioPin;
                const debounce = 200; // TODO maybe configurable?

                rpio.open(gpioPin, rpio.INPUT, rpio.PULL_UP);

                let previous = rpio.HIGH;
                let current;
                let time = 0;

                let interval = setInterval(() => {
                    current = rpio.read(gpioPin);

                    const milliseconds = new Date().getTime();
                    if (current === rpio.LOW && previous === rpio.HIGH && milliseconds - time > debounce) {
                        this.ringTheBell();

                        time = milliseconds;
                    }

                    previous = current;
                }, 100);

                api.on('shutdown', () => {
                    clearInterval(interval);
                    rpio.close(gpioPin);
                })
            });
        }
    }

    static getBellStatus(callback) {
        callback(null, null);
    }

    ringTheBell() {
        this.log("Ding Dong!");
        this.doorbellService.setCharacteristic(hap.Characteristic.ProgrammableSwitchEvent, 0);
    }

    setLockState(state, callback) {
        if (state === this.lockState || !this.lockPin) {
            callback();
            return;
        }

        switch (state) {
            case LockState.UNSECURED:
                this.setLockState0(LockState.UNSECURED);

                this.timer = setTimeout(() => {
                    this.setLockState0(LockState.SECURED, () => {
                        this.lockService.setCharacteristic(hap.Characteristic.LockTargetState, this.lockState);
                    });

                    this.timer = null;
                }, this.unlockTime);
                break;
            case LockState.SECURED:
                if (this.timer) {
                    clearTimeout(this.timer);

                    this.setLockState0(LockState.SECURED);
                    this.timer = null;
                }
                break;
            case LockState.JAMMED:
            case LockState.UNKNOWN:
                break;
        }

        callback();
    }

    setLockState0(state, injectUpdate) {
        this.lockState = state;
        rpio.write(this.lockPin, state === LockState.UNSECURED? rpio.HIGH: rpio.LOW);

        if (injectUpdate)
            injectUpdate();

        this.lockService.setCharacteristic(hap.Characteristic.LockCurrentState, this.lockState);
    }

    getLockState(callback) {
        callback(null, this.lockState);
    }

};
