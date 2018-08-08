# homebridge-doorbell-system
Raspberry Pi video doorbell plugin for homebridge with integrated door lock mechanism service 
using a connected gpio relay to control the lock

This plugin is based on [homebridge-video-doorbell-rpi](https://github.com/Supereg/homebridge-video-doorbell-rpi) which 
again is based on [homebridge-camera-rpi](https://github.com/moritzmhmk/homebridge-camera-rpi) by moritzmhmk,
licensed under MIT license.

## Prerequisite

* camera module activated (`raspi-config`)
* module `bcm2835-v4l2` loaded (add `bcm2835-v4l2` to `/etc/modules` and reboot)
* ffmpeg installed (`sudo apt install ffmpeg` _you probably need to compile ffmpeg by yourself if it isn't available
 in the package manager_)
* **Premissions**:
  * user running homebridge/standalone plugin must be part of the `video` group to access the raspberry pi camera
  * user running homebridge/standalone plugin must be part of the `gpio` group to control the gpio output

## Installation (as homebridge plugin)

```bash
npm install -g homebridge-doorbell-system
```

edit ``config.json`` and add platform ``rpi-doorbell-system``

```json
{
  ...
  "platforms": [
    ...
    {
      "platform": "rpi-doorbell-system",
      "devices": [
        {
          "name": "Pi Doorbell",
        }
      ]
    }
  ]
}
```

restart `homebridge`

add extra camera accessory in the home app (the setup code is the same as for homebridge)

## Installation (standalone)

optionally install in `opt`:

```bash
cd /opt
sudo mkdir homebridge-doorbell-system
sudo chown pi homebridge-doorbell-system
```

install:

```bash
git clone https://github.com/Supereg/homebridge-doorbell-system
cd homebridge-doorbell-system
npm install
```

test:

```bash
node standalone.js
```

 optionally create systemd service `/etc/systemd/system/hap-doorbell-rpi.service`:
 
 ```ini
[Unit]
Description=HAP Doorbell RPi

[Service]
ExecStart=/usr/local/bin/node /opt/homebridge-doorbell-system/standalone.js -c /etc/homebridge-doorbell-system.conf.json
WorkingDirectory=/opt/homebridge-doorbell-system
Restart=always
RestartSec=10
User=pi

[Install]
WantedBy=multi-user.target
 ```
 
 create config file `/etc/homebridge-doorbell-system.conf.json`:

```json
{
  "name": "Pi Doorbell",
  "id": "Pi Doorbell",
  "pincode": "031-45-154",
  "username": "EC:23:3D:D3:CE:CE"
}
```

`id` is used to generate the uuid and defaults to `name` when not defined
 
 enable and start the service:
 
 ```bash
sudo systemctl enable hap-doorbell-rpi
sudo systemctl start hap-doorbell-rpi
```

## Options
```json
{
  "name": "Pi Doorbell",
  "id": "Pi Doorbell",
  "rotate": 0,
  "verticalFlip": false,
  "horizontalFlip": false,
  
  "lock": {
    "name": "Lock",
    "pin": 12,
    "unlockTime": 5000
  },
  
  "ringButton": [
    {
      "gpioPin": 14
    }
  ],
  
  "triggerButton": false,
  "debug": false
}
```

Note: `rotate` currently only works for `0` and `180` degrees.
