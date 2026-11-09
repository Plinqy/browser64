import { Cpu6510, type CpuClockResult } from '../cpu/Cpu6510';
import { Flag } from '../cpu/Flags';
import { D64Image } from '../disk/D64Image';
import { G64Image } from '../disk/G64Image';
import { IecBus, type IecEndpoint } from '../iec/IecBus';
import { Via6522 } from '../via/Via6522';
import { C1541Bus } from './C1541Bus';
import { DriveMechanism1541, type ExportedDriveMedia } from './DriveMechanism1541';

export const C1541_CLOCK_HZ = 1_000_000;

export interface C1541CycleResult {
  readonly cpu: CpuClockResult | null;
  readonly driveCycle: number;
  readonly byteReady: boolean;
}

/**
 * One stock Commodore 1541 as an independent computer on the IEC bus.
 *
 * The drive has its own 1 MHz NMOS 6502 execution core, 2 KiB RAM, two MOS
 * 6522 VIAs, 16 KiB DOS ROM mapping, IEC endpoint, and GCR-backed disk
 * mechanism. No KERNAL LOAD trap is involved: when a ROM is supplied, the
 * drive firmware runs normally and observes the same serial lines as the C64.
 */
export class C1541Drive {
  public readonly via0 = new Via6522();
  public readonly via1 = new Via6522();
  public readonly bus = new C1541Bus(this.via0, this.via1);
  public readonly cpu = new Cpu6510(this.bus);
  public readonly mechanism = new DriveMechanism1541();

  private readonly iecEndpoint: IecEndpoint;
  private driveCycleCounter = 0;
  private resetLineWasHigh = true;
  private lastByteReady = false;

  constructor(
    public readonly iecBus: IecBus,
    public readonly deviceAddress: 8 | 9 | 10 | 11 = 8
  ) {
    this.iecEndpoint = iecBus.createEndpoint(`1541-${deviceAddress}`);
    this.configureViaWiring();
    this.resetElectronics(false);
  }

  loadRom(bytes: ArrayLike<number>): void {
    this.bus.loadRom(bytes);
  }

  mountD64(imageOrBytes: D64Image | ArrayLike<number>, writeProtected = false): D64Image {
    const image = imageOrBytes instanceof D64Image ? imageOrBytes : D64Image.parse(imageOrBytes);
    this.mechanism.mount(image, writeProtected);
    return image;
  }

  mountG64(imageOrBytes: G64Image | ArrayLike<number>, writeProtected = false): G64Image {
    const image = imageOrBytes instanceof G64Image ? imageOrBytes : G64Image.parse(imageOrBytes);
    this.mechanism.mountG64(image, writeProtected);
    return image;
  }

  exportMountedMedia(): ExportedDriveMedia | null {
    return this.mechanism.exportMountedMedia();
  }

  setDiskWriteProtected(writeProtected: boolean): void {
    this.mechanism.setWriteProtected(writeProtected);
  }

  ejectDisk(): void {
    this.mechanism.eject();
  }

  /** Cold drive start: RAM is deterministic zero, while ROM is user supplied. */
  powerOn(): number {
    this.bus.clearRam();
    return this.resetElectronics(true);
  }

  /** Hardware reset preserves drive RAM, mounted media, and physical head position. */
  reset(): number {
    return this.resetElectronics(true);
  }

  /** Advance one 1 MHz 1541 PHI2 cycle. */
  tick(): C1541CycleResult {
    if (!this.iecBus.resetHigh) {
      if (this.resetLineWasHigh) this.resetElectronics(true);
      this.resetLineWasHigh = false;
      this.driveCycleCounter += 1;
      this.lastByteReady = false;
      return { cpu: null, driveCycle: this.driveCycleCounter, byteReady: false };
    }
    this.resetLineWasHigh = true;
    this.syncIecInputs();

    const disk = this.mechanism.tick();
    this.via1.setCa1Line(!disk.byteReady);
    if (disk.byteReady && this.mechanism.overflowEnabled) {
      // The 64H156 BYTE output also drives the 6502 SO pin when CA2/SOE is
      // enabled. CA1 still receives BYTE READY while SOE is disabled.
      this.cpu.setFlag(Flag.Overflow, true);
    }

    this.syncIrqLine();
    const cpuResult = this.bus.hasRom ? this.cpu.clock(true, true) : null;

    this.via0.tick(1);
    this.via1.tick(1);
    this.syncIecOutputs();
    this.syncIrqLine();

    this.driveCycleCounter += 1;
    this.lastByteReady = disk.byteReady;
    return { cpu: cpuResult, driveCycle: this.driveCycleCounter, byteReady: disk.byteReady };
  }

  get cycles(): number { return this.driveCycleCounter; }
  get romLoaded(): boolean { return this.bus.hasRom; }
  get byteReady(): boolean { return this.lastByteReady; }

  private configureViaWiring(): void {
    this.via0.setPortBInputProvider(() => {
      let value = 0;
      if (!this.iecBus.dataHigh) value |= 0x01;
      if (!this.iecBus.clockHigh) value |= 0x04;
      value |= ((this.deviceAddress - 8) & 0x03) << 5;
      if (!this.iecBus.atnHigh) value |= 0x80;
      return value;
    });
    this.via0.setPortAInputProvider(() => 0xff);
    this.via0.setPortBOutputHandler(() => this.syncIecOutputs());

    this.via1.setPortAInputProvider(() => this.mechanism.currentDataByte);
    this.via1.setPortAOutputHandler((pins) => this.mechanism.setWriteDataByte(pins));
    this.via1.setPortBInputProvider(() => {
      let value = 0xff;
      if (this.mechanism.writeProtected) value &= ~0x10;
      if (this.mechanism.syncAsserted) value &= ~0x80;
      return value;
    });
    this.via1.setPortBOutputHandler(() => this.syncMechanismControls());
    this.via1.setCa2OutputHandler((high) => this.mechanism.setByteReadyEnabled(high));
    this.via1.setCb2OutputHandler((high) => this.mechanism.setReadMode(high));
  }

  private syncIecInputs(): void {
    // ATN is presented to VIA0 CA1 as asserted-high after the board inverter.
    this.via0.setCa1Line(!this.iecBus.atnHigh);
  }

  private syncIecOutputs(): void {
    const orb = this.via0.outputRegisterB;
    const ddrb = this.via0.dataDirectionB;

    const dataOut = (ddrb & 0x02) !== 0 && (orb & 0x02) !== 0;
    const clockOut = (ddrb & 0x08) !== 0 && (orb & 0x08) !== 0;
    const atna = (ddrb & 0x10) !== 0 && (orb & 0x10) !== 0;
    const atnInput = !this.iecBus.atnHigh;
    const attentionAcknowledge = atnInput !== atna;

    this.iecEndpoint.setPulledLow('clock', clockOut);
    this.iecEndpoint.setPulledLow('data', dataOut || attentionAcknowledge);
  }

  private syncMechanismControls(): void {
    const orb = this.via1.outputRegisterB;
    const ddrb = this.via1.dataDirectionB;
    const output = (mask: number): boolean => (ddrb & mask) !== 0 && (orb & mask) !== 0;

    if ((ddrb & 0x03) !== 0) this.mechanism.setStepperPhase(orb & 0x03);
    if ((ddrb & 0x04) !== 0) this.mechanism.setMotorEnabled(output(0x04));
    if ((ddrb & 0x08) !== 0) this.mechanism.setActivityLed(output(0x08));
    if ((ddrb & 0x60) !== 0) this.mechanism.setDensitySelect((orb >> 5) & 0x03);
  }

  private syncIrqLine(): void {
    this.cpu.setIrqLine(this.via0.irqAsserted || this.via1.irqAsserted);
  }


  private resetElectronics(resetCpu: boolean): number {
    this.iecEndpoint.releaseAll();
    this.bus.resetIo();
    this.mechanism.resetElectronics();
    this.driveCycleCounter = 0;
    this.lastByteReady = false;
    this.resetLineWasHigh = this.iecBus.resetHigh;
    this.syncIecOutputs();
    this.syncMechanismControls();
    this.syncIecInputs();
    this.syncIrqLine();
    return resetCpu && this.bus.hasRom ? this.cpu.reset() : 0;
  }
}

export { C1541_ROM_SIZE } from './C1541Bus';
