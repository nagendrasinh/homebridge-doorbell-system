'use strict';

const ip = require('ip');
const spawn = require('child_process').spawn;
const crypto = require('crypto');

module.exports = Camera;

function Camera(hap, conf, log) {
    this.hap = hap;
    this.conf = conf;
    this.log = log;

    this.debug = conf.debug || false;

    this.services = [];
    this.streamControllers = [];

    this.pendingSessions = {};
    this.ongoingSessions = {};

    const options = {
        proxy: false, // Requires RTP/RTCP MUX Proxy
        disable_audio_proxy: false, // If proxy = true, you can opt out audio proxy via this
        srtp: true, // Supports SRTP AES_CM_128_HMAC_SHA1_80 encryption
        video: {
            resolutions: [
                // [1920, 1080, 30], // Width, Height, framerate
                // [1280, 960, 30],
                [1280, 720, 30],
                [1024, 768, 30],
                [640, 480, 30],
                [640, 360, 30],
                [480, 360, 30],
                [480, 270, 30],
                [320, 240, 30],
                [320, 240, 15], // Apple Watch requires this configuration
                [320, 180, 30]
            ],
            codec: {
                profiles: [0, 1, 2], // Enum, please refer StreamController.VideoCodecParamProfileIDTypes
                levels: [0, 1, 2] // Enum, please refer StreamController.VideoCodecParamLevelTypes
            }
        },
        audio: {
            comfort_noise: false,
            codecs: [
                {
                    type: 'OPUS', // Audio Codec
                    samplerate: 24 // 8, 16, 24 KHz
                },
                {
                    type: 'AAC-eld',
                    samplerate: 16
                }
            ]
        }
    };
    this._v4l2CTLSetCTRL('rotate', this.conf.rotate || 0);
    this._v4l2CTLSetCTRL('vertical_flip', this.conf.verticalFlip ? 1 : 0);
    this._v4l2CTLSetCTRL('horizontal_flip', this.conf.horizontalFlip ? 1 : 0);
    this.createCameraControlService();
    this._createStreamControllers(2, options);
}

Camera.prototype.handleSnapshotRequest = function (request, callback) {
    const ffmpegCommand = `\
-f video4linux2 -input_format mjpeg -video_size ${request.width}x${request.height} -i /dev/video0 \
-vframes 1 -f mjpeg -`;

    if (this.debug)
        this.log("ffmpeg " + ffmpegCommand);

    const ffmpeg = spawn('ffmpeg', ffmpegCommand.split(' '), {env: process.env});
    let imageBuffer = Buffer.alloc(0);

    ffmpeg.stdout.on('data', function (data) {
        imageBuffer = Buffer.concat([imageBuffer, data])
    }.bind(this));
    if (this.debug) {
        ffmpeg.stderr.on('data', function (data) {
            this.log("ffmpeg " + String(data));
        }.bind(this));
    }
    ffmpeg.on('error', function (error) {
        this.log("Failed to take a snapshot: " + error.message);
    }.bind(this));
    ffmpeg.on('close', function (code) {
        if (!code ||code === 255) {
            this.log(`Took snapshot at ${request.width}x${request.height}`);
            callback(null, imageBuffer);
        }
        else
            this.log(`ffmpeg snapshot exited with code ${code}`)
    }.bind(this));
};

Camera.prototype.handleCloseConnection = function (connectionID) {
    this.streamControllers.forEach(function (controller) {
        controller.handleCloseConnection(connectionID)
    });
};

Camera.prototype.prepareStream = function (request, callback) {
    // Invoked when iOS device requires stream

    let sessionInfo = {};

    const sessionID = request['sessionID'];
    const targetAddress = request['targetAddress'];

    sessionInfo['address'] = targetAddress;

    let response = {};

    const videoInfo = request['video'];
    if (videoInfo) {
        const targetPort = videoInfo['port'];
        const srtpKey = videoInfo['srtp_key'];
        const srtpSalt = videoInfo['srtp_salt'];

        // SSRC is a 32 bit integer that is unique per stream
        const ssrcSource = crypto.randomBytes(4);
        ssrcSource[0] = 0;
        const ssrc = ssrcSource.readInt32BE(0, true);

        response['video'] = {
            port: targetPort,
            ssrc: ssrc,
            srtp_key: srtpKey,
            srtp_salt: srtpSalt
        };

        sessionInfo['video_port'] = targetPort;
        sessionInfo['video_srtp'] = Buffer.concat([srtpKey, srtpSalt]);
        sessionInfo['video_ssrc'] = ssrc
    }

    const audioInfo = request['audio'];
    if (audioInfo) {
        const targetPort = audioInfo['port'];
        const srtpKey = audioInfo['srtp_key'];
        const srtpSalt = audioInfo['srtp_salt'];

        // SSRC is a 32 bit integer that is unique per stream
        const ssrcSource = crypto.randomBytes(4);
        ssrcSource[0] = 0;
        const ssrc = ssrcSource.readInt32BE(0, true);

        response['audio'] = {
            port: targetPort,
            ssrc: ssrc,
            srtp_key: srtpKey,
            srtp_salt: srtpSalt
        };

        sessionInfo['audio_port'] = targetPort;
        sessionInfo['audio_srtp'] = Buffer.concat([srtpKey, srtpSalt]);
        sessionInfo['audio_ssrc'] = ssrc
    }

    const currentAddress = ip.address();
    response['address'] = {
        address: currentAddress,
        type: ip.isV4Format(currentAddress) ? "v4" : "v6"
    };

    this.pendingSessions[this.hap.uuid.unparse(sessionID)] = sessionInfo;

    callback(response)
};

Camera.prototype.handleStreamRequest = function (request) {
    const sessionID = request['sessionID'];
    const requestType = request['type'];
    if (!sessionID)
        return;

    const sessionIdentifier = this.hap.uuid.unparse(sessionID);

    if (requestType === 'start' && this.pendingSessions[sessionIdentifier]) {
        let width = 1280;
        let height = 720;
        let fps = 30;
        let bitrate = 300;

        if (request['video']) {
            width = request['video']['width'];
            height = request['video']['height'];
            fps = Math.min(fps, request['video']['fps']); // TODO define max fps
            bitrate = request['video']['max_bit_rate']
        }

        this._v4l2CTLSetCTRL('video_bitrate', `${bitrate}000`);

        const srtp = this.pendingSessions[sessionIdentifier]['video_srtp'].toString('base64');
        const address = this.pendingSessions[sessionIdentifier]['address'];
        const port = this.pendingSessions[sessionIdentifier]['video_port'];
        const ssrc = this.pendingSessions[sessionIdentifier]['video_ssrc'];

        this.log(`Starting video stream (${width}x${height}, ${fps} fps, ${bitrate} kbps)`)

        const ffmpegCommand = `\
-f video4linux2 -input_format h264 -video_size ${width}x${height} -framerate ${fps} -i /dev/video0 \
-vcodec copy -an -payload_type 99 -ssrc ${ssrc} -f rtp \
-srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ${srtp} \
srtp://${address}:${port}?rtcpport=${port}&localrtcpport=${port}&pkt_size=1378`;
        if (this.debug)
            this.log("ffmpeg " + ffmpegCommand);

        const ffmpeg = spawn('ffmpeg', ffmpegCommand.split(' '), {env: process.env});

        // Always setup hook on stderr.
        // Without this streaming stops within one to two minutes.
        ffmpeg.stderr.on('data', data => {
            if (this.debug)
                this.log("ffmpeg " + String(data));
        });
        ffmpeg.on('error', function (error) {
            this.log("Failed to start video stream: " + error.message);
        }.bind(this));
        ffmpeg.on('close', function (code) {
            if (!code || code === 255)
                this.log("Video stream stopped");
            else
                this.log(`ffmpeg video stream exited with code ${code}`)
        }.bind(this));

        this.ongoingSessions[sessionIdentifier] = ffmpeg;

        delete this.pendingSessions[sessionIdentifier]
    }

    if (requestType === 'stop' && this.ongoingSessions[sessionIdentifier]) {
        this.ongoingSessions[sessionIdentifier].kill('SIGKILL');
        delete this.ongoingSessions[sessionIdentifier]
    }
};

Camera.prototype.createCameraControlService = function () {
    const controlService = new this.hap.Service.CameraControl();

    // Developer can add control characteristics like rotation, night vision at here.

    this.services.push(controlService)
};

// Private

Camera.prototype._createStreamControllers = function (maxStreams, options) {
    for (let i = 0; i < maxStreams; i++) {
        const streamController = new this.hap.StreamController(i, options, this);

        this.services.push(streamController.service);
        this.streamControllers.push(streamController);
    }
};

Camera.prototype._v4l2CTLSetCTRL = function (name, value) {
    const v4l2ctlCommand = `--set-ctrl ${name}=${value}`;
    if (this.debug)
        this.log("v4l2-ctl " + v4l2ctlCommand);

    const v4l2ctl = spawn('v4l2-ctl', v4l2ctlCommand.split(' '), {env: process.env});

    v4l2ctl.on('error', function (error) {
        this.log(`Failed setting ${name} to ${value}: ${error.message}`)
    }.bind(this));
    if (this.debug) {
        v4l2ctl.stderr.on('data', function (data) {
            this.log('v4l2-ctl ' + String(data))
        }.bind(this));
    }
};
