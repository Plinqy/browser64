import { describe, expect, it } from 'vitest';
import { Cia6526, CiaInterrupt } from '../../src/core/cia/Cia6526';

function pulseCnt(cia: Cia6526, spHigh = true): void {
  cia.setSpLine(spHigh);
  cia.setCntLine(false);
  cia.setCntLine(true);
}

function pulseTod(cia: Cia6526, count: number): void {
  for (let i = 0; i < count; i += 1) {
    cia.pulseTod();
  }
}

describe('Cia6526 reset and parallel ports', () => {
  it('resets ports to inputs, timers to $FFFF, and interrupt state clear', () => {
    const cia = new Cia6526();

    expect(cia.read(0x00)).toBe(0xff);
    expect(cia.read(0x01)).toBe(0xff);
    expect(cia.read(0x02)).toBe(0x00);
    expect(cia.read(0x03)).toBe(0x00);
    expect(cia.timerACounter).toBe(0xffff);
    expect(cia.timerBCounter).toBe(0xffff);
    expect(cia.read(0x0e)).toBe(0x00);
    expect(cia.read(0x0f)).toBe(0x00);
    expect(cia.irqAsserted).toBe(false);
  });

  it('combines output latches, DDRs, and external input pins', () => {
    const cia = new Cia6526();
    cia.setPortAInputProvider(() => 0xa5);
    cia.write(0x00, 0x3c);
    cia.write(0x02, 0xf0);

    expect(cia.read(0x00)).toBe(0x25);
    expect(cia.portAOutputLowMask).toBe(0xc0);
  });

  it('reads external lows on output-high port pins like real 6526 hardware', () => {
    const cia = new Cia6526();
    cia.setPortAInputProvider(() => 0xee); // UP + FIRE externally grounded.
    cia.write(0x00, 0xff); // CIA tries to drive every output high.
    cia.write(0x02, 0xff); // All Port A pins are outputs, as KERNAL configures CIA1.

    expect(cia.read(0x00)).toBe(0xee);

    cia.write(0x00, 0xfe); // CIA itself also drives UP low.
    cia.setPortAInputProvider(() => 0xff);
    expect(cia.read(0x00)).toBe(0xfe);
  });
});

describe('Cia6526 timers and interrupts', () => {
  it('uses the old-6526 START/count pipeline and delays the master IRQ latch by one PHI2', () => {
    const cia = new Cia6526();
    cia.write(0x04, 0x02);
    cia.write(0x05, 0x00);
    cia.write(0x0d, 0x80 | CiaInterrupt.TimerA);
    cia.write(0x0e, 0x01);

    cia.tick(2);
    expect(cia.timerACounter).toBe(2); // START has not reached the count stage yet.
    cia.tick(1);
    expect(cia.timerACounter).toBe(1);
    cia.tick(1);

    expect(cia.timerACounter).toBe(2); // underflow reloads without exposing zero in PHI2 mode
    expect(cia.interruptFlagsValue & CiaInterrupt.TimerA).toBe(CiaInterrupt.TimerA);
    expect(cia.irqAsserted).toBe(false); // source latch is visible one cycle before master IRQ

    cia.tick(1);
    expect(cia.irqAsserted).toBe(true);
    expect(cia.peek(0x0d)).toBe(0x80 | CiaInterrupt.TimerA);
    expect(cia.read(0x0d)).toBe(0x80 | CiaInterrupt.TimerA);
    expect(cia.irqAsserted).toBe(false);
    expect(cia.peek(0x0d)).toBe(0x00);
  });

  it('delays force-load through the timer load pipeline while a timer is running', () => {
    const cia = new Cia6526();
    cia.write(0x04, 0x05);
    cia.write(0x05, 0x00);
    cia.write(0x0e, 0x01);
    cia.tick(4);
    expect(cia.timerACounter).toBe(3);

    cia.write(0x04, 0x09);
    cia.write(0x05, 0x00); // running: updates latch but does not immediately load counter
    cia.write(0x0e, 0x11); // START + force load

    cia.tick(1);
    expect(cia.timerACounter).toBe(2);
    cia.tick(1);
    expect(cia.timerACounter).toBe(9);
  });

  it('stops a one-shot timer on the underflow after the START pipeline', () => {
    const cia = new Cia6526();
    cia.write(0x04, 0x01);
    cia.write(0x05, 0x00);
    cia.write(0x0e, 0x09);

    cia.tick(2);
    expect(cia.controlA & 0x01).toBe(0x01);
    cia.tick(1);

    expect(cia.timerACounter).toBe(1);
    expect(cia.controlA & 0x01).toBe(0);
    expect(cia.interruptFlagsValue & CiaInterrupt.TimerA).toBe(CiaInterrupt.TimerA);
  });

  it('cascades Timer B from pipelined Timer A underflows', () => {
    const cia = new Cia6526();
    cia.write(0x04, 0x02);
    cia.write(0x05, 0x00);
    cia.write(0x06, 0x02);
    cia.write(0x07, 0x00);
    cia.write(0x0e, 0x01);
    cia.write(0x0f, 0x41); // start; count Timer A underflows

    cia.tick(4); // first Timer-A underflow has entered Timer-B's count pipeline
    expect(cia.timerBCounter).toBe(2);
    cia.tick(1);
    expect(cia.timerBCounter).toBe(1);
    cia.tick(3);
    expect(cia.timerBCounter).toBe(0);
    cia.tick(2);

    expect(cia.timerBCounter).toBe(2);
    expect(cia.interruptFlagsValue & CiaInterrupt.TimerB).toBe(CiaInterrupt.TimerB);
  });

  it('uses CNT high as the reset default for Timer-B underflow+CNT mode', () => {
    const cia = new Cia6526();
    cia.write(0x04, 0x00);
    cia.write(0x05, 0x00);
    cia.write(0x06, 0x01);
    cia.write(0x07, 0x00);
    cia.write(0x0e, 0x01);
    cia.write(0x0f, 0x61); // Timer-A underflows, gated by CNT high

    cia.tick(3);

    expect(cia.interruptFlagsValue & CiaInterrupt.TimerB).toBe(CiaInterrupt.TimerB);
  });

  it('latches masked sources, delays IMR-triggered IRQ, and only ICR read releases an asserted IRQ', () => {
    const cia = new Cia6526();
    cia.setFlagLine(false);

    expect(cia.interruptFlagsValue & CiaInterrupt.Flag).toBe(CiaInterrupt.Flag);
    expect(cia.irqAsserted).toBe(false);

    cia.write(0x0d, 0x80 | CiaInterrupt.Flag);
    expect(cia.irqAsserted).toBe(false);
    cia.tick(1);
    expect(cia.irqAsserted).toBe(true);

    cia.write(0x0d, CiaInterrupt.Flag); // clearing IMR cannot clear the IRQ flip-flop
    expect(cia.irqAsserted).toBe(true);
    expect(cia.interruptFlagsValue & CiaInterrupt.Flag).toBe(CiaInterrupt.Flag);

    expect(cia.read(0x0d)).toBe(0x80 | CiaInterrupt.Flag);
    expect(cia.irqAsserted).toBe(false);
  });

  it('synchronizes Timer-A CNT edges through the timer pipeline', () => {
    const cia = new Cia6526();
    cia.write(0x04, 0x01);
    cia.write(0x05, 0x00);
    cia.write(0x0e, 0x21);

    cia.tick(20);
    expect(cia.timerACounter).toBe(1);

    pulseCnt(cia);
    expect(cia.timerACounter).toBe(1);
    cia.tick(1);
    expect(cia.timerACounter).toBe(1);
    cia.tick(1);
    expect(cia.timerACounter).toBe(0);

    pulseCnt(cia);
    cia.tick(1);
    expect(cia.timerACounter).toBe(1);
    expect(cia.interruptFlagsValue & CiaInterrupt.TimerA).toBe(CiaInterrupt.TimerA);
  });

  it('raises FLAG only on the negative edge and exposes its IRQ one PHI2 later', () => {
    const cia = new Cia6526();
    cia.write(0x0d, 0x80 | CiaInterrupt.Flag);

    cia.setFlagLine(false);
    expect(cia.irqAsserted).toBe(false);
    cia.tick(1);
    expect(cia.irqAsserted).toBe(true);
    expect(cia.read(0x0d)).toBe(0x80 | CiaInterrupt.Flag);

    cia.setFlagLine(false);
    cia.tick(1);
    expect(cia.irqAsserted).toBe(false);
    cia.setFlagLine(true);
    cia.setFlagLine(false);
    expect(cia.irqAsserted).toBe(false);
    cia.tick(1);
    expect(cia.irqAsserted).toBe(true);
  });
});

describe('Cia6526 TOD and serial input', () => {
  it('uses 60 Hz TOD input by default and rolls 11:59:59.9 AM to noon', () => {
    const cia = new Cia6526();
    cia.write(0x0b, 0x11);
    cia.write(0x0a, 0x59);
    cia.write(0x09, 0x59);
    cia.write(0x08, 0x09);

    pulseTod(cia, 6);

    expect(cia.read(0x0b)).toBe(0x92);
    expect(cia.read(0x0a)).toBe(0x00);
    expect(cia.read(0x09)).toBe(0x00);
    expect(cia.read(0x08)).toBe(0x00);
  });

  it('latches TOD on an hours read until tenths is read', () => {
    const cia = new Cia6526();
    cia.write(0x0b, 0x01);
    cia.write(0x0a, 0x02);
    cia.write(0x09, 0x59);
    cia.write(0x08, 0x09);

    expect(cia.read(0x0b)).toBe(0x01); // latch 01:02:59.9
    pulseTod(cia, 6); // live clock becomes 01:03:00.0

    expect(cia.read(0x0a)).toBe(0x02);
    expect(cia.read(0x08)).toBe(0x09); // releases the read latch
    expect(cia.read(0x0a)).toBe(0x03);
  });

  it('raises the alarm interrupt when TOD reaches the programmed alarm', () => {
    const cia = new Cia6526();
    cia.write(0x0f, 0x80); // alarm write select
    cia.write(0x0b, 0x01);
    cia.write(0x0a, 0x00);
    cia.write(0x09, 0x00);
    cia.write(0x08, 0x01);

    cia.write(0x0f, 0x00);
    cia.write(0x0b, 0x01);
    cia.write(0x0a, 0x00);
    cia.write(0x09, 0x00);
    cia.write(0x08, 0x00);
    cia.write(0x0d, 0x80 | CiaInterrupt.Alarm);

    pulseTod(cia, 6);

    expect(cia.irqAsserted).toBe(false);
    cia.tick(1);
    expect(cia.irqAsserted).toBe(true);
    expect(cia.peek(0x0d)).toBe(0x80 | CiaInterrupt.Alarm);
  });

  it('shifts serial input on CNT rising edges and raises SP interrupt after eight bits', () => {
    const cia = new Cia6526();
    cia.write(0x0d, 0x80 | CiaInterrupt.Serial);

    for (const bit of [1, 0, 1, 0, 0, 1, 0, 1]) {
      pulseCnt(cia, bit === 1);
    }

    expect(cia.read(0x0c)).toBe(0xa5);
    expect(cia.irqAsserted).toBe(false);
    cia.tick(1);
    expect(cia.irqAsserted).toBe(true);
    expect(cia.peek(0x0d)).toBe(0x80 | CiaInterrupt.Serial);
  });
});
