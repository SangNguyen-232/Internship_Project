#ifndef SERIAL_LOG_H
#define SERIAL_LOG_H

/** Call once from setup() after Serial.begin so multi-task Serial output does not interleave. */
void serialLogInit(void);
void serialLogLock(void);
void serialLogUnlock(void);

#endif
