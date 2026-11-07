import { describe, expect, it } from 'vitest';
import { sidEnvelopeDac, sidWaveDac } from '../../src/core/sid/SidDac';
import { SidEnvelope, SidEnvelopeState } from '../../src/core/sid/SidEnvelope';

function drainToZero(envelope: SidEnvelope): void {
  for (let cycle = 0; cycle < 100_000 && envelope.level !== 0; cycle += 1) envelope.clock();
  expect(envelope.level).toBe(0);
}

describe('SidEnvelope cycle timing', () => {
  it('clocks fastest attack from the hardware 15-bit ADSR LFSR phase', () => {
    const envelope = new SidEnvelope('8580');
    drainToZero(envelope);
    envelope.writeAttackDecay(0x00);
    envelope.setGate(true);

    for (let cycle = 0; cycle < 7; cycle += 1) envelope.clock();
    expect(envelope.level).toBe(0);
    envelope.clock();

    expect(envelope.level).toBe(1);
    expect(envelope.state).toBe(SidEnvelopeState.Attack);
  });

  it('preserves the ADSR delay bug because rate writes do not reset the counter', () => {
    const envelope = new SidEnvelope('8580');
    drainToZero(envelope);
    envelope.writeAttackDecay(0xf0);
    envelope.setGate(true);
    envelope.clock();
    envelope.clock();
    for (let cycle = 0; cycle < 100; cycle += 1) envelope.clock();
    expect(envelope.rateCounterValue).toBeGreaterThan(8);

    const lfsrBeforeRateWrite = envelope.rateLfsrValue;
    envelope.writeAttackDecay(0x00);
    expect(envelope.rateLfsrValue).toBe(lfsrBeforeRateWrite);
    for (let cycle = 0; cycle < 100; cycle += 1) envelope.clock();
    expect(envelope.level).toBe(0);

    for (let cycle = 0; cycle < 33_000 && envelope.level === 0; cycle += 1) envelope.clock();
    expect(envelope.level).toBeGreaterThan(0);
  });

  it('reproduces the $FF->$00 boundary freeze when RELEASE is followed by ATTACK', () => {
    const envelope = new SidEnvelope('8580');
    drainToZero(envelope);
    envelope.writeAttackDecay(0x77);
    envelope.writeSustainRelease(0x77);
    envelope.setGate(true);

    for (let cycle = 0; cycle < 100_000 && envelope.level !== 0xff; cycle += 1) envelope.clock();
    expect(envelope.level).toBe(0xff);

    envelope.setGate(false);
    envelope.clock();
    envelope.clock();
    envelope.clock();
    envelope.setGate(true);
    for (let cycle = 0; cycle < 315; cycle += 1) envelope.clock();

    expect(envelope.level).toBe(0);
  });

  it('allows the $00->$FF wrap when ATTACK is followed quickly by RELEASE', () => {
    const envelope = new SidEnvelope('8580');
    drainToZero(envelope);
    envelope.writeAttackDecay(0x77);
    envelope.writeSustainRelease(0x77);

    envelope.setGate(true);
    envelope.clock();
    envelope.clock();
    envelope.clock();
    envelope.setGate(false);
    for (let cycle = 0; cycle < 315; cycle += 1) envelope.clock();

    expect(envelope.level).toBe(0xff);
  });

  it('latches ENV3 at the beginning of a SID cycle', () => {
    const envelope = new SidEnvelope('8580');
    drainToZero(envelope);
    envelope.writeAttackDecay(0x00);
    envelope.setGate(true);

    for (let cycle = 0; cycle < 7; cycle += 1) envelope.clock();
    expect(envelope.readbackLevel).toBe(0);
    envelope.clock();

    expect(envelope.level).toBe(1);
    expect(envelope.readbackLevel).toBe(0);
    envelope.clock();
    expect(envelope.readbackLevel).toBe(1);
  });

  it('preserves the measured ADSR delay when a rate is shortened mid-LFSR sequence', () => {
    const envelope = new SidEnvelope('8580');
    const internals = envelope as unknown as { envelopeCounter: number };
    internals.envelopeCounter = 0;

    envelope.writeAttackDecay(0x70);
    envelope.setGate(true);
    for (let cycle = 0; cycle < 200; cycle += 1) envelope.clock();
    expect(envelope.level).toBe(1);

    envelope.writeAttackDecay(0x20);
    for (let cycle = 0; cycle < 200; cycle += 1) envelope.clock();
    expect(envelope.level).toBe(1);
  });

  it('preserves the envelope counter across RESET while resetting ADSR controls', () => {
    const envelope = new SidEnvelope('8580');
    const powerUpLevel = envelope.level;
    expect(powerUpLevel).toBe(0xaa);

    envelope.reset();

    expect(envelope.level).toBe(powerUpLevel);
    expect(envelope.state).toBe(SidEnvelopeState.Release);
    expect(envelope.rateLfsrValue).toBe(0x7fff);
  });
});

describe('SID DAC models', () => {
  it('keeps 8580 DACs ideal and models the unterminated 6581 major-carry discontinuity', () => {
    expect(sidWaveDac('8580', 0x7ff)).toBe(0x7ff);
    expect(sidWaveDac('8580', 0x800)).toBe(0x800);
    expect(sidEnvelopeDac('8580', 0x80)).toBe(0x80);

    expect(sidWaveDac('6581', 0x800)).toBeLessThan(sidWaveDac('6581', 0x7ff));
    expect(sidEnvelopeDac('6581', 0x80)).toBeLessThan(sidEnvelopeDac('6581', 0x7f));
  });
});
