'use strict';

const fs = require('fs');
const spawn = require('child_process').spawn;

let Service, Characteristic;

module.exports = ClimateSensor;

function ClimateSensor(hap, config, log) {
    this.config = config;
    this.log = log;

    Service = hap.Service;
    Characteristic = hap.Characteristic;

    if (!(config.climateSensor))
        return;

    if (config.climateSensor.systemTemp) {
        this.systemTempName = config.climateSensor.systemTempName || "System Temperature";
        this.systemTempService = new Service.TemperatureSensor(this.systemTempName, "system-temp");
        this.systemTempService.getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', this.getSystemTemp.bind(this));
    }

    if (!config.climateSensor.gpioPin)
        return;

    this.temperatureName = config.climateSensor.temperatureName || "Temperature";
    this.humidityName = config.climateSensor.humidityName || "Humidity";

    this.gpioPin = config.climateSensor.gpioPin;
    this.querySeconds = config.climateSensor.querySeconds || 20;

    this.temperature = 0.0;
    this.humidity = 0;

    if (!fs.existsSync('dth11Sensor.py'))
        this.log("Climate Sensor Python bridge could not be found!");
    else {
        this.temperatureService = new Service.TemperatureSensor(this.temperatureName, "temp-sensor");
        this.temperatureService.getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', callback => {
                callback(null, this.temperature);
            });

        this.humidityService = new Service.HumiditySensor(this.humidityName);
        this.humidityService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
            .on('get', callback => {
                callback(null, this.humidity);
            });

        setTimeout(this.querySensor.bind(this), 20);
    }
}

ClimateSensor.prototype.getServices = function () {
    const services = [];

    if (this.temperatureService)
        services.push(this.temperatureService);
    if (this.humidityService)
        services.push(this.humidityService);

    if (this.systemTempService)
        services.push(this.systemTempService);

    return services;
};

ClimateSensor.prototype.getSystemTemp = function (callback) {
    fs.readFile("/sys/class/thermal/thermal_zone0/temp", "utf8", (error, data) => {
        if (error) {
            callback(error);
        }
        else {
            let value = parseInt(String(data).replace("\n", ""));
            value = Math.trunc(value / 100) / 10;
            value = Math.trunc(value * 2) / 2;

            callback(null, value);
        }
    });
};

ClimateSensor.prototype.querySensor = function () {
    const python = spawn('python', ['dth11Sensor.py', this.gpioPin], {env: process.env});
    let result = "";
    python.stdout.on('data', data => {
        result += String(data);
    });

    python.on('exit', (code, signal) => {
        result = result.replace("\n", "");

        if (result !== "invalid") {
            const split = result.split('|');

            let temperature = parseFloat(split[0].replace("temp:", ""));
            const humidity = parseInt(split[1].replace("hum:", ""));

            temperature = Math.trunc(temperature * 2) / 2; // round to nearest 0.5 decimal

            if (this.humidity !== humidity) {
                this.humidity = humidity;
                this.humidityService.setCharacteristic(Characteristic.CurrentRelativeHumidity, this.humidity);
            }

            if (this.temperature !== temperature) {
                this.temperature = temperature;
                this.temperatureService.setCharacteristic(Characteristic.CurrentTemperature, this.temperature);
            }
        }
        else {
            this.log("Got invalid result from dth11 sensor script!");
        }

        setTimeout(this.querySensor.bind(this), this.querySeconds * 1000);
    });
};