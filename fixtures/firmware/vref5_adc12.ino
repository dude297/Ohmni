// SYNTHETIC EXAMPLE - not real product firmware. Reference case for Ohmni firmware-adc.
#define VREF 5.0          // wrong: the board actually runs at 3.3 V
const int ADC_PIN = 34;

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
}

void loop() {
  int counts = analogRead(ADC_PIN);
  float volts = counts * VREF / 4095.0;
  Serial.println(volts);
  delay(500);
}
