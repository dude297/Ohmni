// SYNTHETIC EXAMPLE - not real product firmware.
#define VREF 3.3
void loop() {
  int raw = analogRead(A0);
  float rail = raw * VREF / 4095.0 * 2.0;  // multiplies back up for a 1:2 divider
}
