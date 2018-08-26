'use strict';

const ip = require('ip');
const spawn = require('child_process').spawn;
const crypto = require('crypto');
const fs = require('fs');
const sharp = require('sharp');

module.exports = CameraSource;

const SourceState = Object.freeze({
    UNUSED: 0,
    USED_VIDEO_STREAM: 1,
    USED_SNAPSHOT: 2
});

function CameraSource(hap, api, config, log) {
    this.hap = hap;
    this.api = api;
    this.config = config;
    this.log = log;

    this.debug = this.config.debug || false;

    this.services = [];
    this.streamControllers = [];

    this.pendingSessions = {};
    this.ongoingSessions = {};

    this.snapshotFilename = "snapshot.jpg";
    this.lastSnapshot = {
        time: 0,
        buffer: undefined,
        width: undefined,
        height: undefined
    };

    this.sourceState = SourceState.UNUSED;
    // this.streamSubscriptions = [];

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
            codec: { // we only support profile 'high' with level '4.0'
                profiles: [2], // Enum, please refer StreamController.VideoCodecParamProfileIDTypes
                levels: [2] // Enum, please refer StreamController.VideoCodecParamLevelTypes
            }
        },
        audio: {
            comfort_noise: false,
            codecs: [
                {
                    type: 'AAC-eld',
                    samplerate: 16
                },
                {
                    type: 'AAC-eld',
                    samplerate: 24
                }
            ]
        }
    };

    // TODO set h264 profile and level
    this._v4l2CTLSetCTRL('rotate', this.config.rotate || 0);
    this._v4l2CTLSetCTRL('vertical_flip', this.config['verticalFlip'] ? 1 : 0);
    this._v4l2CTLSetCTRL('horizontal_flip', this.config['horizontalFlip'] ? 1 : 0);

    this._createCameraControlService();
    // we only advertise one streaming controller. Raspicam does not support concurrent access on the video stream
    this._createStreamControllers(options, 1);

    api.on('ring', () => {
        this._captureSnapshot(480, 270, (error, buffer) => {});
    });
}

CameraSource.prototype._createCameraControlService = function () {
    const controlService = new this.hap.Service.CameraControl();

    controlService.getCharacteristic(this.hap.Characteristic.On)
        .on('get', callback => {
            callback(null, true);
            this.log("Getting On State");
        })
        .on('set', (on, callback) => {
            this.log("Setting On State");
            callback();
        });

    controlService.addCharacteristic(this.hap.Characteristic.ImageRotation)
        .on('get', callback => {
            callback(null, this.config.rotate);
            this.log("Getting ImageRotation");
        })
        .on('set', (rotation, callback) => {
            this.log("Setting ImageRotation " + rotation);
            callback();
        });

    controlService.addCharacteristic(this.hap.Characteristic.ImageMirroring)
        .on('get', callback => {
            callback(null, false);
            this.log("Getting ImageMirroring");
        })
        .on('set', (mirroring, callback) => {
            this.log("Setting ImageMirroring " + mirroring);
            callback();
        });

    // Developer can add control characteristics like rotation, night vision at here.

    this.services.push(controlService)
};

CameraSource.prototype._createStreamControllers = function (options, streamCount) {
    for (let i = 0; i < streamCount; i++) {
        const streamController = new this.hap.StreamController(i, options, this);

        this.services.push(streamController.service);
        this.streamControllers.push(streamController);
    }
};

CameraSource.prototype.handleCloseConnection = function (connectionID) {
    this.streamControllers.forEach(function (controller) {
        controller.handleCloseConnection(connectionID)
    });
};

CameraSource.prototype._forceStopController = function (sessionID) {
    for (let i = 0; i < this.streamControllers.length; i++) {
        const controller = this.streamControllers[i];
        if (controller.sessionIdentifier === sessionID) {
            controller.forceStop();
        }
    }
};

CameraSource.prototype.handleSnapshotRequest = function (request, callback) {
    if (new Date().getTime() - this.lastSnapshot.time <= 5000  // if last snapshot was captured in less 5s ago
        && this.lastSnapshot.width === request.width && this.lastSnapshot.height === request.height) { // and same aspect ratio
        this.log("Used snapshot buffer!");
        callback(null, this.lastSnapshot.buffer);
    }
    else {
        switch (this.sourceState) {
            case SourceState.UNUSED:
                this._captureSnapshot(request.width, request.height, callback);
                break;
            case SourceState.USED_VIDEO_STREAM:
                this._readSnapshotFromFS(request.width, request.height, callback);
                break;
            case SourceState.USED_SNAPSHOT:
                setTimeout(() => {
                    this.handleSnapshotRequest(request, callback);
                }, 50);
                break;
        }
    }
};

CameraSource.prototype._readSnapshotFromFS = function (width, height, callback) {
    if (!fs.existsSync(this.snapshotFilename)) {
        this.log("Snapshot file does not exist!");
        callback(new Error("Snapshot file does not exist!"));
        return;
    }

    sharp(this.snapshotFilename)
        .resize(width, height)
        .toBuffer((error, data) => {
            if (error) {
                this.log("Error reading and resizing snapshot from filesystem");
                this.log(error);
                callback(error);
            }
            else {
                callback(null, data);
            }
        });
};

CameraSource.prototype._captureSnapshot = function (width, height, callback) {
    this.sourceState = SourceState.USED_SNAPSHOT;

    const ffmpegCommand = `-f v4l2 -input_format mjpeg -video_size ${width}x${height} -i /dev/video0 \
-vframes 1 -f mjpeg -`;
    const ffmpeg = spawn('ffmpeg', ffmpegCommand.split(' '), {env: process.env});

    let snapshotBuffer = Buffer.alloc(0);
    ffmpeg.stdout.on('data', data => {
        snapshotBuffer = Buffer.concat([snapshotBuffer, data]);
    });

    ffmpeg.stderr.on('data', data => {
        if (this.debug)
            this.log('ffmpeg-snap-stderr ' + String(data));
    });

    ffmpeg.on('exit', (code, signal) => {
        this.sourceState = SourceState.UNUSED;

        if (signal) {
            this.log("Snapshot process was killed with signal: " + signal);
            callback(new Error("killed with signal " + signal));
        }
        else if (code === 0) {
            this.log(`Successfully captured snapshot at ${width}x${height}`);

            this.lastSnapshot = {
                time: new Date().getTime(),
                buffer: snapshotBuffer,
                width: width,
                height: height
            };
            callback(null, snapshotBuffer);
        }
        else {
            this.log("Snapshot process exited with code " + code);
            callback(new Error("Snapshot proccess exited with code " + code));
        }
    });
};

CameraSource.prototype.prepareStream = function (request, callback) {
    const sessionID = request['sessionID'];
    const sessionIdentifier = this.hap.uuid.unparse(sessionID, 0);

    let sessionInfo = {};
    sessionInfo.address = request['targetAddress'];

    let response = {};

    const currentAddress = ip.address();
    response.address = {
        address: currentAddress,
        type: ip.isV4Format(currentAddress) ? "v4" : "v6"
    };

    const videoInfo = request.video;
    if (videoInfo) {
        // SSRC is a 32 bit integer that is unique per stream
        const ssrcSource = crypto.randomBytes(4);
        ssrcSource[0] = 0;
        const ssrc = ssrcSource.readInt32BE(0, true);

        response.video = {
            port: videoInfo.port,
            ssrc: ssrc,
            srtp_key: videoInfo.srtp_key,
            srtp_salt: videoInfo.srtp_salt

        };

        sessionInfo.video_port = response.video.port;
        sessionInfo.video_srtp = Buffer.concat([response.video.srtp_key, response.video.srtp_salt]);
        sessionInfo.video_ssrc = ssrc
    }

    const audioInfo = request['audio'];
    if (audioInfo) {
        // SSRC is a 32 bit integer that is unique per stream
        const ssrcSource = crypto.randomBytes(4);
        ssrcSource[0] = 0;
        const ssrc = ssrcSource.readInt32BE(0, true);

        response.audio = {
            port: audioInfo.port,
            ssrc: ssrc,
            srtp_key: audioInfo.srtp_key,
            srtp_salt: audioInfo.srtp_salt
        };

        sessionInfo.audio_port = response.audio.port;
        sessionInfo.audio_srtp = Buffer.concat([response.audio.srtp_key, response.audio.srtp_salt]);
        sessionInfo.audio_ssrc = ssrc
    }

    this.pendingSessions[sessionIdentifier] = sessionInfo;

    callback(response);
};

CameraSource.prototype.handleStreamRequest = function (request) {
    const sessionID = request['sessionID'];
    const requestType = request['type'];
    if (!sessionID)
        return;

    const sessionIdentifier = this.hap.uuid.unparse(sessionID, 0);

    switch (requestType) {
        case "start":
            this._startStream(sessionID, sessionIdentifier, request);
            break;
        case "reconfigure":
            this._reconfigureStream(sessionIdentifier, request);
            break;
        case "stop":
            this._stopStream(sessionIdentifier);
            break;
        default:
            this.log("Got unknown request type: " + requestType);
    }
};

CameraSource.prototype._startStream = function (sessionID, sessionIdentifier, request) {
    if (!this.pendingSessions[sessionIdentifier]) {
        this.log(`Got start stream request but sessionIdentifier (${sessionIdentifier}) could not be found in pendingSessions`);
        return;
    }

    if (this.sourceState === SourceState.USED_SNAPSHOT) {
        setTimeout(() => {
            this._startStream(sessionID, sessionIdentifier, request);
        }, 50);
        return;
    }
    else if (this.sourceState === SourceState.USED_VIDEO_STREAM)
        return;

    let width = 1280;
    let height = 720;
    let fps = 30;
    let videoBitrate = 300;

    let videoPayloadType = 99;
    let maximalTransmissionUnit = 1378;

    if (request.video) {
        width = request.video['width'];
        height = request.video['height'];
        fps = Math.min(fps, request.video['fps']); // TODO define max fps
        videoBitrate = request.video['max_bit_rate'];

        videoPayloadType = request.video['pt'];
        maximalTransmissionUnit = request.video['mtu'];
    }

    const address = this.pendingSessions[sessionIdentifier].address;

    const videoPort = this.pendingSessions[sessionIdentifier].video_port;
    const videoSrtp = this.pendingSessions[sessionIdentifier].video_srtp.toString('base64');
    const videoSsrc = this.pendingSessions[sessionIdentifier].video_ssrc;

    this.log(`Starting video stream (${width}x${height}, ${fps} fps, ${videoBitrate} kbps)...`);

    /*
    const videoffmpegCommand = `\
-f v4l2 -i /dev/video1 -c:v h264_omx -s ${width}x${height} -r ${fps} -b:v ${videoBitrate}k -maxrate ${videoBitrate}k \
-bufsize ${2*videoBitrate}k -profile:v ${h264Profile} -level:v ${h264Level} -tune zerolatency -an \
-payload_type ${videoPayloadType} -ssrc ${videoSsrc} -f rtp -srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ${videoSrtp} \
srtp://${address}:${videoPort}?rtcpport=${videoPort}&localrtcpport=${videoPort}&pkt_size=${maximalTransmissionUnit}`;
    */
    this._v4l2CTLSetCTRL('video_bitrate', `${videoBitrate}000`);

    // TODO debug ffmpeg command
    const videoffmpegCommand = `\
-f v4l2 -re -input_format h264 -framerate ${fps} -video_size ${width}x${height} -i /dev/video0 \
-c:v copy -an -payload_type ${videoPayloadType} -ssrc ${videoSsrc} -f rtp -srtp_out_suite AES_CM_128_HMAC_SHA1_80 \
-srtp_out_params ${videoSrtp} srtp://${address}:${videoPort}?rtcpport=${videoPort}&localrtcpport=${videoPort}&pkt_size=${maximalTransmissionUnit} \
-vf fps=1/5 -update 1 -y ${this.snapshotFilename}`;
    const ffmpegVideo = spawn('ffmpeg', videoffmpegCommand.split(' '), {env: process.env});

    ffmpegVideo.on('error', error => {
        this.log("Failed to spawn/kill ffmpeg video process: " + error.message);
    });
    // Always setup hook on stderr.
    // Without this streaming stops within one to two minutes.
    ffmpegVideo.stderr.on('data', data => {
        if (this.debug)
            this.log("ffmpeg-video " + String(data));
    });

    ffmpegVideo.on('exit', (code, signal) => {
        this.log("ffmpeg-video exited with code: " + code + " and signal: " + signal); // TODO debug

        if (code == null || code === 255)
            this.log("Video stream stopped");
        else {
            this.log(`ffmpeg video stream exited with code ${code}`);

            this._forceStopController(sessionID);
        }
    });

    let channel = 1;
    let audioBitrate = 16;
    let sampleRate = 16000;

    let audioPayloadType = 110;
    let audioPacketTime = 30;

    if (request.audio) {
        if (request.audio['codec'] !== "AAC-eld")
            this.log("Unexpected codec of " + request['audio']['codec'] + ".");

        channel = request.audio['channel'];
        audioBitrate = request.audio['max_bit_rate'];
        sampleRate = request.audio['sample_rate'];

        audioPayloadType = request.audio['pt'];
        audioPacketTime = request.audio['packet_time'];
    }

    const audioPort = this.pendingSessions[sessionIdentifier].audio_port;
    const audioSrtp = this.pendingSessions[sessionIdentifier].audio_srtp.toString('base64');
    const audioSsrc = this.pendingSessions[sessionIdentifier].audio_ssrc;

    const audioffmpegCommand = `\
-f alsa -re -i hw:1,0 -c:a aac -vn -ac ${channel} -ar ${sampleRate}k -b:a ${audioBitrate}k \
-payload_type ${audioPayloadType} -ssrc ${audioSsrc} -f rtp -srtp_out_suite AES_CM_128_HMAC_SHA1_80 -srtp_out_params ${audioSrtp} \
-rtsp_transport tcp srtp://${address}:${audioPort}?rtcpport=${audioPort}&localrtcpport=${audioPort}&pkt_size=188`;

    /*const ffmpegAudio = spawn('ffmpeg', audioffmpegCommand.split(' '), {env: process.env});
    // Always setup hook on stderr.
    // Without this streaming stops within one to two minutes.
    ffmpegAudio.stderr.on('data', data => {
        if (this.debug)
            this.log("ffmpeg-audio " + String(data));
    });
    ffmpegAudio.on('error', function (error) {
        this.log("Failed to start audio stream: " + error.message);
    }.bind(this));
    ffmpegAudio.on('close', function (code) {
        if (!code || code === 255)
            this.log("Audio stream stopped");
        else {
            this.log(`ffmpeg audio stream exited with code ${code}`)
        }
    }.bind(this));*/

    this.sourceState = SourceState.USED_VIDEO_STREAM;
    this.ongoingSessions[sessionIdentifier] = {
        videoProcess: ffmpegVideo,
        audioProcess: undefined
    };

    delete this.pendingSessions[sessionIdentifier]
};

CameraSource.prototype._reconfigureStream = function (sessionIdentifier, request) {
    const video = request.video;

    this.log(`Received reconfigure with ${video.width}x${video.height} at ${video.fps} fps and ${video.max_bit_rate} kbps`);
    // TODO implement
};

CameraSource.prototype._stopStream = function (sessionIdentifier) {
    if (!this.ongoingSessions[sessionIdentifier]) {
        this.log(`Got stop stream request but sessionIdentifier (${sessionIdentifier}) could not be found in ongoingSessions`);
        return;
    }

    const session = this.ongoingSessions[sessionIdentifier];
    try {
        session.videoProcess.kill('SIGKILL');
    } catch (e) {
        this.log("Error occurred terminating the video process!");
        this.log(e);
    }

    /*try {
        session.audio.kill('SIGKILL');
    } catch (e) {
        this.log(e);
    }*/
    this.sourceState = SourceState.UNUSED;
    delete this.ongoingSessions[sessionIdentifier];

    if (fs.existsSync(this.snapshotFilename))
        fs.unlinkSync(this.snapshotFilename);
};


CameraSource.prototype._v4l2CTLSetCTRL = function (name, value) {
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