# homebridge-video-doorbell-rpi
Raspberry Pi video doorbell plugin for homebridge.

This plugin is based on [homebridge-camera-rpi](https://github.com/moritzmhmk/homebridge-camera-rpi) by moritzmhmk
licensed under MIT license.

## Prerequisite

* camera module activated (`raspi-config`)
* module `bcm2835-v4l2` loaded (add `bcm2835-v4l2` to `/etc/modules` and reboot)
* ffmpeg installed (`sudo apt install ffmpeg` _you probably need to compile ffmpeg by yourself if it isn't available
 in the package manager_)

## Installation (as homebridge plugin)

```bash
npm install -g homebridge-video-doorbell-rpi
```

edit ``config.json`` and add platform ``rpi-doorbell``

```json
{
  ...
  "platforms": [
    ...
    {
      "platform": "rpi-doorbell",
      "doorbells": [
        {
          "name": "Pi Video Doorbell",
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
sudo mkdir homebridge-video-doorbell-rpi
sudo chown pi homebridge-video-doorbell-rpi
```

install:

```bash
git clone https://github.com/Supereg/homebridge-video-doorbell-rpi
cd homebridge-video-doorbell-rpi
npm install
```

test:

```bash
node standalone.js
```

 optionally create systemd service `/etc/systemd/system/hap-doorbell-rpi.service`:
 
 ```ini
[Unit]
Description=HAP Video Doorbell RPi

[Service]
ExecStart=/usr/local/bin/node /opt/homebridge-video-doorbell-rpi/standalone.js -c /etc/homebridge-video-doorbell-rpi.conf.json
WorkingDirectory=/opt/homebridge-video-doorbell-rpi
Restart=always
RestartSec=10
User=pi

[Install]
WantedBy=multi-user.target
 ```
 
 create config file `/etc/homebridge-video-doorbell-rpi.conf.json`:

```json
{
  "name": "Pi Video Doorbell",
  "id": "Pi Video Doorbell",
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
  "name": "Pi Video Doorbell",
  "id": "Pi Video Doorbell",
  "rotate": 0,
  "verticalFlip": false,
  "horizontalFlip": false
}
```

Note: `rotate` currently only works for `0` and `180` degrees.
