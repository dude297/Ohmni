# SYNTHETIC EXAMPLE - not real product firmware.
from machine import ADC, Pin
adc = ADC(Pin(26))
VREF = 3.3
v = adc.read_u16() * VREF / 65535
