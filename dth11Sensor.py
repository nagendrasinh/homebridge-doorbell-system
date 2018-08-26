#!/usr/bin/python
import Adafruit_DHT
import sys

if len(sys.argv) != 2:
    print 'Missing pin argument'
    sys.exit(2)

gpioPin = int(sys.argv[1])

humidity, temperature = Adafruit_DHT.read_retry(Adafruit_DHT.DHT11, gpioPin, delay_seconds=1)

if humidity is not None and temperature is not None:
    print 'temp:{0:0.1f}|hum:{1}'.format(temperature, humidity)
else:
    print 'invalid'
