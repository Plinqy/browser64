import './ui/styles.css';
import {
  BASIC_ROM_SIZE,
  C64Machine,
  CHARACTER_ROM_SIZE,
  KERNAL_ROM_SIZE,
  type C64RomKind
} from './core';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Missing #app element.');
}

const machine = new C64Machine();
const traceLines: string[] = [];
let poweredOn = false;
let lastError = '';

app.innerHTML = `
  <section class="shell">
    <header>
      <p class="eyebrow">FROM-SCRATCH C64 EMULATOR</p>
      <h1>Commodore 64 Development Console</h1>
      <p>v0.3 — 6510 core, C64 banking, and functional MOS 6526 CIA chips.</p>
    </header>

    <article class="panel rom-panel">
      <div class="panel-heading">
        <div>
          <h2>Motherboard ROMs</h2>
          <p>Supply your own unheadered ROM images. They stay local in this browser session.</p>
        </div>
        <div id="rom-complete" class="status-pill">3 ROMs required</div>
      </div>

      <div class="rom-grid">
        ${romInput('basic', 'BASIC ROM', BASIC_ROM_SIZE)}
        ${romInput('kernal', 'KERNAL ROM', KERNAL_ROM_SIZE)}
        ${romInput('character', 'Character ROM', CHARACTER_ROM_SIZE)}
      </div>
    </article>

    <section class="toolbar">
      <button id="power-on" disabled>Power On</button>
      <button id="reset" disabled>Reset</button>
      <button id="step" disabled>Step</button>
      <button id="run100" disabled>Run 100</button>
    </section>

    <div id="error" class="error-banner" hidden></div>

    <section class="grid">
      <article class="panel">
        <h2>6510</h2>
        <pre id="registers"></pre>
      </article>
      <article class="panel">
        <h2>Memory configuration</h2>
        <pre id="memory-map"></pre>
      </article>
      <article class="panel">
        <h2>CIA / VIC bank</h2>
        <pre id="cia-state"></pre>
      </article>
      <article class="panel wide-panel">
        <h2>Next instructions</h2>
        <pre id="disassembly"></pre>
      </article>
    </section>

    <article class="panel trace-panel">
      <h2>Trace</h2>
      <pre id="trace"></pre>
    </article>
  </section>
`;

const registersElement = mustElement('registers');
const memoryMapElement = mustElement('memory-map');
const ciaStateElement = mustElement('cia-state');
const disassemblyElement = mustElement('disassembly');
const traceElement = mustElement('trace');
const errorElement = mustElement('error');
const romCompleteElement = mustElement('rom-complete');
const powerOnButton = mustButton('power-on');
const resetButton = mustButton('reset');
const stepButton = mustButton('step');
const run100Button = mustButton('run100');

for (const kind of ['basic', 'kernal', 'character'] as const) {
  const input = mustInput(`rom-${kind}`);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file === undefined) {
      machine.bus.roms.unload(kind);
      setRomStatus(kind, 'Not loaded', false);
      poweredOn = false;
      traceLines.length = 0;
      updateControls();
      render();
      return;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      machine.loadRom(kind, bytes);
      setRomStatus(kind, `${file.name} · ${bytes.length} bytes`, true);
      lastError = '';
      poweredOn = false;
      traceLines.length = 0;
    } catch (error) {
      machine.bus.roms.unload(kind);
      setRomStatus(kind, errorMessage(error), false);
      lastError = errorMessage(error);
    }

    updateControls();
    render();
  });
}

powerOnButton.addEventListener('click', () => {
  if (!machine.bus.roms.complete) {
    return;
  }

  try {
    machine.powerOn();
    poweredOn = true;
    lastError = '';
    traceLines.length = 0;
    traceLines.push(`POWER ON -> reset vector $${hex(machine.cpu.pc, 4)}`);
  } catch (error) {
    lastError = errorMessage(error);
  }

  updateControls();
  render();
});

resetButton.addEventListener('click', () => {
  if (!poweredOn) {
    return;
  }

  try {
    machine.reset();
    lastError = '';
    traceLines.push(`RESET -> reset vector $${hex(machine.cpu.pc, 4)}`);
  } catch (error) {
    lastError = errorMessage(error);
  }

  render();
});

stepButton.addEventListener('click', () => {
  doStep();
  render();
});

run100Button.addEventListener('click', () => {
  for (let i = 0; i < 100 && poweredOn && lastError === ''; i += 1) {
    doStep();
  }
  render();
});

updateControls();
render();

function doStep(): void {
  if (!poweredOn) {
    return;
  }

  try {
    traceLines.push(machine.trace.formatCurrent());
    machine.step();
  } catch (error) {
    lastError = errorMessage(error);
  }
}

function render(): void {
  const cpu = machine.cpu;
  const config = machine.bus.configuration;

  registersElement.textContent = poweredOn
    ? [
        `PC   $${hex(cpu.pc, 4)}`,
        `A    $${hex(cpu.a, 2)}`,
        `X    $${hex(cpu.x, 2)}`,
        `Y    $${hex(cpu.y, 2)}`,
        `SP   $${hex(cpu.sp, 2)}`,
        `P    %${cpu.status.toString(2).padStart(8, '0')}`,
        `CYC  ${cpu.cycles}`
      ].join('\n')
    : 'Load all three ROMs, then Power On.';

  memoryMapElement.textContent = [
    `$0000 DDR     $${hex(machine.bus.processorPortDataDirection, 2)}`,
    `$0001 LATCH   $${hex(machine.bus.processorPortDataLatch, 2)}`,
    `PORT PINS     $${hex(config.port, 2)}`,
    '',
    `LORAM         ${bit(config.loram)}`,
    `HIRAM         ${bit(config.hiram)}`,
    `CHAREN        ${bit(config.charen)}`,
    '',
    `$A000-$BFFF   ${config.basicVisible ? 'BASIC ROM' : 'RAM'}`,
    `$D000-$DFFF   ${config.ioVisible ? 'I/O' : config.characterVisible ? 'CHAR ROM' : 'RAM'}`,
    `$E000-$FFFF   ${config.kernalVisible ? 'KERNAL ROM' : 'RAM'}`
  ].join('\n');

  ciaStateElement.textContent = [
    `CIA1 TA       $${hex(machine.bus.io.cia1.timerACounter, 4)}`,
    `CIA1 TB       $${hex(machine.bus.io.cia1.timerBCounter, 4)}`,
    `CIA1 ICR      $${hex(machine.bus.io.cia1.peek(0x0d), 2)}`,
    `CIA1 IRQ      ${machine.bus.io.cia1.irqAsserted ? 'ASSERTED' : 'clear'}`,
    '',
    `CIA2 PA       $${hex(machine.bus.io.cia2.portAPins, 2)}`,
    `CIA2 DDRA     $${hex(machine.bus.io.cia2.dataDirectionA, 2)}`,
    `CIA2 ICR      $${hex(machine.bus.io.cia2.peek(0x0d), 2)}`,
    `CIA2 IRQ/NMI  ${machine.bus.io.cia2.irqAsserted ? 'ASSERTED' : 'clear'}`,
    '',
    `VIC BANK      ${machine.bus.vicBankNumber}`,
    `VIC BASE      $${hex(machine.bus.vicBankBase, 4)}`
  ].join('\n');

  disassemblyElement.textContent = poweredOn
    ? machine.disassembler
        .disassembleRange(cpu.pc, 10)
        .map((entry) => `${hex(entry.address, 4)}  ${entry.bytes.map((byte) => hex(byte, 2)).join(' ').padEnd(8, ' ')} ${entry.text}`)
        .join('\n')
    : 'Waiting for a real KERNAL reset vector.';

  traceElement.textContent = traceLines.length > 0
    ? traceLines.slice(-24).join('\n')
    : 'No instructions executed yet.';

  errorElement.hidden = lastError === '';
  errorElement.textContent = lastError;

  if (machine.bus.roms.complete) {
    romCompleteElement.textContent = 'ROM set ready';
    romCompleteElement.classList.add('ready');
  } else {
    const loadedCount = (['basic', 'kernal', 'character'] as const)
      .filter((kind) => machine.bus.roms.isLoaded(kind)).length;
    romCompleteElement.textContent = `${loadedCount}/3 ROMs loaded`;
    romCompleteElement.classList.remove('ready');
  }
}

function updateControls(): void {
  powerOnButton.disabled = !machine.bus.roms.complete;
  resetButton.disabled = !poweredOn;
  stepButton.disabled = !poweredOn;
  run100Button.disabled = !poweredOn;
}

function setRomStatus(kind: C64RomKind, text: string, valid: boolean): void {
  const status = mustElement(`status-${kind}`);
  status.textContent = text;
  status.classList.toggle('valid', valid);
  status.classList.toggle('invalid', !valid);
}

function romInput(kind: C64RomKind, label: string, size: number): string {
  return `
    <label class="rom-input">
      <span>${label}</span>
      <small>${size} bytes</small>
      <input id="rom-${kind}" type="file" accept=".rom,.bin,application/octet-stream" />
      <em id="status-${kind}">Not loaded</em>
    </label>
  `;
}

function bit(value: boolean): string {
  return value ? '1' : '0';
}

function mustElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing #${id} element.`);
  }
  return element;
}

function mustButton(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Missing button #${id}.`);
  }
  return element;
}

function mustInput(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Missing input #${id}.`);
  }
  return element;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hex(value: number, width: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, '0');
}
