import './ui/styles.css';
import {
  BASIC_ROM_SIZE,
  C64Machine,
  C64_PALETTE,
  CHARACTER_ROM_SIZE,
  KERNAL_ROM_SIZE,
  VIC_FRAMEBUFFER_HEIGHT,
  VIC_FRAMEBUFFER_WIDTH,
  VicGraphicsMode,
  parsePrg,
  type C64RomKind,
  type SidChipModel
} from './core';
import { SidAudio } from './audio/SidAudio';
import { HostInputController, type JoystickCapturePort } from './input/HostInputController';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Missing #app element.');
}

const machine = new C64Machine();
const sidAudio = new SidAudio(machine.bus.io.sid);
const traceLines: string[] = [];
let poweredOn = false;
let running = false;
let lastError = '';
let audioError = '';
let selectedPrg: { name: string; bytes: Uint8Array } | null = null;
let animationFrame: number | null = null;
let lastAnimationTime = 0;
let frameAccumulatorMs = 0;

app.innerHTML = `
  <section class="shell">
    <header>
      <p class="eyebrow">FROM-SCRATCH C64 EMULATOR</p>
      <h1>Commodore 64 Development Console</h1>
      <p>v0.8 — cycle-clocked MOS 6581/8580 SID synthesis, filters, model selection, and AudioWorklet output.</p>
    </header>

    <article class="panel rom-panel">
      <div class="panel-heading">
        <div>
          <h2>Motherboard ROMs</h2>
          <p>Supply your own unheadered ROM images. Power On starts execution at the real KERNAL reset vector.</p>
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
      <button id="run-toggle" disabled>Run</button>
      <button id="reset" disabled>Reset</button>
      <button id="restore" disabled>RESTORE</button>
      <button id="step" disabled>Step</button>
      <button id="run100" disabled>Run 100</button>
      <button id="run-frame" disabled>Run Frame</button>
    </section>

    <div id="error" class="error-banner" hidden></div>

    <article class="panel sid-panel">
      <div class="panel-heading">
        <div>
          <h2>SID audio</h2>
          <p>Cycle-rate synthesis is deterministic; Web Audio only consumes PCM produced by the emulated SID.</p>
        </div>
        <div id="audio-status" class="status-pill">Audio off</div>
      </div>
      <div class="sid-controls">
        <label>
          Chip model
          <select id="sid-model">
            <option value="6581">MOS 6581</option>
            <option value="8580">MOS 8580</option>
          </select>
        </label>
        <button id="audio-enable">Enable / Resume Audio</button>
        <button id="audio-mute">Mute</button>
      </div>
    </article>

    <article class="panel display-panel">
      <div class="panel-heading">
        <div>
          <h2>VIC-II display</h2>
          <p>Click the display to capture the C64 keyboard. Page Up = RESTORE, Escape = RUN/STOP, Alt = Commodore.</p>
        </div>
        <div id="vic-position" class="status-pill"></div>
      </div>
      <div class="screen-wrap">
        <canvas id="vic-screen" tabindex="0" width="${VIC_FRAMEBUFFER_WIDTH}" height="${VIC_FRAMEBUFFER_HEIGHT}" aria-label="C64 display and keyboard input"></canvas>
      </div>
      <div class="input-toolbar">
        <label>
          Arrow keys / Space
          <select id="joystick-capture">
            <option value="keyboard">C64 keyboard</option>
            <option value="1">Joystick port 1</option>
            <option value="2">Joystick port 2</option>
          </select>
        </label>
        <span id="input-status">Click display to type</span>
      </div>
    </article>

    <article id="program-panel" class="panel program-panel">
      <div class="panel-heading">
        <div>
          <h2>PRG Loader</h2>
          <p>Choose or drop a .PRG after the C64 reaches READY. BASIC files at $0801 update BASIC pointers; machine-code launch is explicit.</p>
        </div>
        <div id="prg-status" class="status-pill">No PRG selected</div>
      </div>
      <div class="program-controls">
        <input id="prg-file" type="file" accept=".prg,application/octet-stream" />
        <button id="load-prg" disabled>Load PRG</button>
        <button id="run-prg" disabled>Load + Jump to Address</button>
      </div>
    </article>

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
        <h2>CIA / VIC / SID</h2>
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
const vicPositionElement = mustElement('vic-position');
const inputStatusElement = mustElement('input-status');
const prgStatusElement = mustElement('prg-status');
const audioStatusElement = mustElement('audio-status');
const programPanel = mustElement('program-panel');
const vicCanvas = mustCanvas('vic-screen');
const vicContext = must2dContext(vicCanvas);
const vicImage = vicContext.createImageData(VIC_FRAMEBUFFER_WIDTH, VIC_FRAMEBUFFER_HEIGHT);

const powerOnButton = mustButton('power-on');
const runToggleButton = mustButton('run-toggle');
const resetButton = mustButton('reset');
const restoreButton = mustButton('restore');
const stepButton = mustButton('step');
const run100Button = mustButton('run100');
const runFrameButton = mustButton('run-frame');
const loadPrgButton = mustButton('load-prg');
const runPrgButton = mustButton('run-prg');
const prgInput = mustInput('prg-file');
const joystickSelect = mustSelect('joystick-capture');
const sidModelSelect = mustSelect('sid-model');
const audioEnableButton = mustButton('audio-enable');
const audioMuteButton = mustButton('audio-mute');

const hostInput = new HostInputController(machine.bus.io.keyboard, {
  setRestorePressed: (pressed) => machine.setRestorePressed(pressed),
  setJoystickControl: (port, control, pressed) => machine.setJoystickControl(port, control, pressed)
});

for (const kind of ['basic', 'kernal', 'character'] as const) {
  const input = mustInput(`rom-${kind}`);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file === undefined) {
      machine.bus.roms.unload(kind);
      setRomStatus(kind, 'Not loaded', false);
      powerDownUiState();
      updateControls();
      render();
      return;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      machine.loadRom(kind, bytes);
      setRomStatus(kind, `${file.name} · ${bytes.length} bytes`, true);
      lastError = '';
      powerDownUiState();
    } catch (error) {
      machine.bus.roms.unload(kind);
      setRomStatus(kind, errorMessage(error), false);
      lastError = errorMessage(error);
      powerDownUiState();
    }

    updateControls();
    render();
  });
}

powerOnButton.addEventListener('click', async () => {
  if (!machine.bus.roms.complete) {
    return;
  }

  try {
    await tryStartAudio();
    machine.powerOn();
    sidAudio.clear();
    poweredOn = true;
    lastError = '';
    traceLines.length = 0;
    traceLines.push(`POWER ON -> reset vector $${hex(machine.cpu.pc, 4)}`);
    setRunning(true);
    vicCanvas.focus();
  } catch (error) {
    fail(error);
  }

  updateControls();
  render();
});

runToggleButton.addEventListener('click', () => {
  setRunning(!running);
  updateControls();
  render();
});

resetButton.addEventListener('click', () => {
  if (!poweredOn) {
    return;
  }

  try {
    machine.reset();
    sidAudio.clear();
    lastError = '';
    traceLines.push(`RESET -> reset vector $${hex(machine.cpu.pc, 4)}`);
  } catch (error) {
    fail(error);
  }

  render();
});

restoreButton.addEventListener('click', () => {
  if (!poweredOn) {
    return;
  }
  machine.setRestorePressed(true);
  machine.setRestorePressed(false);
  traceLines.push('RESTORE -> NMI edge');
  render();
});

stepButton.addEventListener('click', () => {
  doStep();
  render();
});

run100Button.addEventListener('click', () => {
  for (let i = 0; i < 100 && poweredOn && lastError === ''; i += 1) {
    doStep(false);
  }
  sidAudio.flush();
  render();
});

runFrameButton.addEventListener('click', () => {
  if (!poweredOn) {
    return;
  }

  try {
    const startFrame = machine.bus.io.vic.frameNumber;
    const executed = machine.runFrame();
    traceLines.push(
      `RUN FRAME ${startFrame} -> ${machine.bus.io.vic.frameNumber} (${executed} instructions)`
    );
    sidAudio.flush();
    lastError = '';
  } catch (error) {
    fail(error);
  }
  render();
});

prgInput.addEventListener('change', async () => {
  const file = prgInput.files?.[0];
  if (file === undefined) {
    selectedPrg = null;
    updatePrgStatus();
    updateControls();
    return;
  }
  await selectPrg(file);
});

loadPrgButton.addEventListener('click', () => loadSelectedPrg(false));
runPrgButton.addEventListener('click', () => loadSelectedPrg(true));

programPanel.addEventListener('dragover', (event) => {
  event.preventDefault();
  programPanel.classList.add('drop-active');
});
programPanel.addEventListener('dragleave', () => programPanel.classList.remove('drop-active'));
programPanel.addEventListener('drop', (event) => {
  event.preventDefault();
  programPanel.classList.remove('drop-active');
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) {
    void selectPrg(file);
  }
});

joystickSelect.addEventListener('change', () => {
  hostInput.setJoystickCapture(joystickCaptureFromValue(joystickSelect.value));
  updateInputStatus();
  vicCanvas.focus();
});

sidModelSelect.addEventListener('change', () => {
  machine.bus.io.sid.setModel(sidModelSelect.value as SidChipModel);
  sidAudio.clear();
  render();
});

audioEnableButton.addEventListener('click', async () => {
  await tryStartAudio();
  render();
});

audioMuteButton.addEventListener('click', () => {
  sidAudio.setMuted(!sidAudio.isMuted);
  audioMuteButton.textContent = sidAudio.isMuted ? 'Unmute' : 'Mute';
  render();
});

vicCanvas.addEventListener('keydown', (event) => {
  if (!poweredOn || event.metaKey) {
    return;
  }
  if (hostInput.keyDown(event.code, event.key)) {
    event.preventDefault();
    updateInputStatus();
  }
});

vicCanvas.addEventListener('keyup', (event) => {
  if (hostInput.keyUp(event.code)) {
    event.preventDefault();
    updateInputStatus();
  }
});

vicCanvas.addEventListener('focus', updateInputStatus);
vicCanvas.addEventListener('blur', () => {
  hostInput.releaseAll();
  updateInputStatus();
});

window.addEventListener('blur', () => {
  hostInput.releaseAll();
  updateInputStatus();
});

document.addEventListener('visibilitychange', () => {
  lastAnimationTime = 0;
  frameAccumulatorMs = 0;
});

updateControls();
updatePrgStatus();
updateInputStatus();
render();

function doStep(flush = true): void {
  if (!poweredOn) {
    return;
  }

  try {
    traceLines.push(machine.trace.formatCurrent());
    machine.step();
    if (flush) sidAudio.flush();
  } catch (error) {
    fail(error);
  }
}

function setRunning(next: boolean): void {
  running = poweredOn && next;
  runToggleButton.textContent = running ? 'Pause' : 'Run';
  lastAnimationTime = 0;
  frameAccumulatorMs = 0;

  if (running && animationFrame === null) {
    animationFrame = requestAnimationFrame(animationTick);
  }
}

function animationTick(timestamp: number): void {
  animationFrame = null;
  if (!running || !poweredOn) {
    return;
  }

  const vic = machine.bus.io.vic;
  const frameDurationMs = (vic.timing.cyclesPerLine * vic.timing.linesPerFrame / vic.timing.systemClockHz) * 1000;

  if (lastAnimationTime === 0) {
    lastAnimationTime = timestamp;
  } else {
    frameAccumulatorMs += Math.min(timestamp - lastAnimationTime, 100);
    lastAnimationTime = timestamp;
  }

  try {
    let frames = 0;
    while (frameAccumulatorMs >= frameDurationMs && frames < 4) {
      machine.runFrame();
      frameAccumulatorMs -= frameDurationMs;
      frames += 1;
    }

    if (frames > 0) sidAudio.flush();

    if (frames === 4 && frameAccumulatorMs > frameDurationMs * 4) {
      frameAccumulatorMs = frameDurationMs;
    }
  } catch (error) {
    fail(error);
  }

  render();
  if (running) {
    animationFrame = requestAnimationFrame(animationTick);
  }
}

async function selectPrg(file: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parsePrg(bytes);
    selectedPrg = { name: file.name, bytes };
    lastError = '';
    prgStatusElement.textContent = `${file.name} · $${hex(parsed.loadAddress, 4)} · ${parsed.payload.length} bytes`;
    prgStatusElement.classList.add('ready');
  } catch (error) {
    selectedPrg = null;
    lastError = errorMessage(error);
    updatePrgStatus();
  }
  updateControls();
  render();
}

function loadSelectedPrg(jumpToLoadAddress: boolean): void {
  if (!poweredOn || selectedPrg === null) {
    return;
  }

  try {
    const result = machine.loadPrg(selectedPrg.bytes);
    if (jumpToLoadAddress) {
      machine.startAt(result.loadAddress);
      traceLines.push(
        `PRG ${selectedPrg.name} -> $${hex(result.loadAddress, 4)}-$${hex(result.endAddressExclusive - 1, 4)}; PC=$${hex(result.loadAddress, 4)}`
      );
      setRunning(true);
    } else {
      traceLines.push(
        `PRG ${selectedPrg.name} -> $${hex(result.loadAddress, 4)}-$${hex(result.endAddressExclusive - 1, 4)}` +
        (result.basicPointersInitialized ? ' (BASIC pointers updated)' : '')
      );
    }
    lastError = '';
    vicCanvas.focus();
  } catch (error) {
    fail(error);
  }

  updateControls();
  render();
}

async function tryStartAudio(): Promise<void> {
  try {
    await sidAudio.start();
    audioError = '';
  } catch (error) {
    // Browser audio failure must not stop the emulated machine.
    audioError = errorMessage(error);
  }
}

function powerDownUiState(): void {
  poweredOn = false;
  setRunning(false);
  hostInput.releaseAll();
  traceLines.length = 0;
}

function fail(error: unknown): void {
  lastError = errorMessage(error);
  setRunning(false);
}

function render(): void {
  const cpu = machine.cpu;
  const config = machine.bus.configuration;
  const vic = machine.bus.io.vic;

  registersElement.textContent = poweredOn
    ? [
        `PC   $${hex(cpu.pc, 4)}`,
        `A    $${hex(cpu.a, 2)}`,
        `X    $${hex(cpu.x, 2)}`,
        `Y    $${hex(cpu.y, 2)}`,
        `SP   $${hex(cpu.sp, 2)}`,
        `P    %${cpu.status.toString(2).padStart(8, '0')}`,
        `CPU CYC  ${cpu.cycles}`,
        `SYS CYC  ${machine.masterCycles}`,
        `STALLS   ${machine.cpuStallCycles}`,
        `RUNNING  ${running ? 'yes' : 'no'}`
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
    `CIA1 IRQ      ${machine.bus.io.cia1.irqAsserted ? 'ASSERTED' : 'clear'}`,
    `JOY1 PINS     %${machine.bus.io.joystick1InputPins.toString(2).padStart(8, '0')}`,
    `JOY2 PINS     %${machine.bus.io.joystick2InputPins.toString(2).padStart(8, '0')}`,
    '',
    `CIA2 PA       $${hex(machine.bus.io.cia2.portAPins, 2)}`,
    `VIC BANK      ${machine.bus.vicBankNumber} ($${hex(machine.bus.vicBankBase, 4)})`,
    '',
    `RASTER        ${vic.rasterLine}:${vic.rasterCycle}`,
    `RASTER CMP    $${hex(vic.rasterCompare, 3)}`,
    `VIC IRQ       ${vic.irqAsserted ? 'ASSERTED' : 'clear'}`,
    `BAD LINE      ${vic.badLine ? 'YES' : 'no'}`,
    `BA            ${vic.baHigh ? 'HIGH' : 'LOW'}`,
    `AEC           ${vic.aecHigh ? 'HIGH' : 'LOW'}`,
    `C-ACCESSES    ${vic.cAccessesThisFrame}`,
    `G-ACCESSES    ${vic.gAccessesThisFrame}`,
    `SPR DATA      ${vic.spriteDataAccessesThisFrame}`,
    `MODE          ${graphicsModeName(vic.graphicsMode)}`,
    `VC / VCBASE   $${hex(vic.videoCounter, 3)} / $${hex(vic.videoCounterBase, 3)}`,
    `RC / VMLI     ${vic.rowCounter} / ${vic.videoMatrixLineIndex}`,
    `DISPLAY       ${vic.displayState ? 'active' : 'idle'}`,
    `SP-SP COLL    $${hex(vic.spriteSpriteCollisionBits, 2)}`,
    `SP-BG COLL    $${hex(vic.spriteBackgroundCollisionBits, 2)}`,
    `FRAME         ${vic.frameNumber}`,
    `SCREEN        +$${hex(vic.screenMemoryOffset, 4)}`,
    `CHARS         +$${hex(vic.characterMemoryOffset, 4)}`,
    `BITMAP        +$${hex(vic.bitmapMemoryOffset, 4)}`,
    '',
    `SID MODEL     ${machine.bus.io.sid.model}`,
    `SID FC        ${Math.round(machine.bus.io.sid.filter.cutoffHz)} Hz`,
    `SID RES/VOL   ${machine.bus.io.sid.filter.resonanceValue} / ${machine.bus.io.sid.filter.volume}`,
    `OSC3 / ENV3   $${hex(machine.bus.io.sid.voices[2].oscillator.oscByte, 2)} / $${hex(machine.bus.io.sid.voices[2].envelope.level, 2)}`,
    `SID PCM QUEUE ${machine.bus.io.sid.queuedAudioSamples}`
  ].join('\n');

  vicPositionElement.textContent = `${vic.timing.chip} · line ${vic.rasterLine} · cycle ${vic.rasterCycle}`;

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

  audioStatusElement.textContent = audioError !== ''
    ? `${machine.bus.io.sid.model} · unavailable`
    : sidAudio.active
      ? `${machine.bus.io.sid.model} · ${sidAudio.state}${sidAudio.isMuted ? ' · muted' : ''}`
      : `${machine.bus.io.sid.model} · audio off`;
  audioStatusElement.title = audioError;
  audioStatusElement.classList.toggle('ready', sidAudio.active && sidAudio.state === 'running' && !sidAudio.isMuted);

  renderVicCanvas();
}

function renderVicCanvas(): void {
  const frame = machine.bus.io.vic.renderFrame();
  const pixels = vicImage.data;

  for (let index = 0; index < frame.length; index += 1) {
    const [red, green, blue] = C64_PALETTE[frame[index] ?? 0] ?? C64_PALETTE[0]!;
    const target = index * 4;
    pixels[target] = red;
    pixels[target + 1] = green;
    pixels[target + 2] = blue;
    pixels[target + 3] = 0xff;
  }

  vicContext.putImageData(vicImage, 0, 0);
}

function updateControls(): void {
  powerOnButton.disabled = !machine.bus.roms.complete;
  runToggleButton.disabled = !poweredOn;
  resetButton.disabled = !poweredOn;
  restoreButton.disabled = !poweredOn;
  stepButton.disabled = !poweredOn || running;
  run100Button.disabled = !poweredOn || running;
  runFrameButton.disabled = !poweredOn || running;
  loadPrgButton.disabled = !poweredOn || selectedPrg === null;
  runPrgButton.disabled = !poweredOn || selectedPrg === null;
  runToggleButton.textContent = running ? 'Pause' : 'Run';
}

function updatePrgStatus(): void {
  if (selectedPrg === null) {
    prgStatusElement.textContent = 'No PRG selected';
    prgStatusElement.classList.remove('ready');
    return;
  }

  const parsed = parsePrg(selectedPrg.bytes);
  prgStatusElement.textContent = `${selectedPrg.name} · $${hex(parsed.loadAddress, 4)} · ${parsed.payload.length} bytes`;
  prgStatusElement.classList.add('ready');
}

function updateInputStatus(): void {
  if (!poweredOn) {
    inputStatusElement.textContent = 'Power on to enable input';
    return;
  }

  if (document.activeElement !== vicCanvas) {
    inputStatusElement.textContent = 'Click display to capture input';
    return;
  }

  const port = joystickCaptureFromValue(joystickSelect.value);
  inputStatusElement.textContent = port === null
    ? 'Keyboard captured'
    : `Joystick port ${port}: arrows + Space`;
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

function graphicsModeName(mode: VicGraphicsMode): string {
  switch (mode) {
    case VicGraphicsMode.STANDARD_TEXT: return 'standard text';
    case VicGraphicsMode.MULTICOLOR_TEXT: return 'multicolor text';
    case VicGraphicsMode.STANDARD_BITMAP: return 'standard bitmap';
    case VicGraphicsMode.MULTICOLOR_BITMAP: return 'multicolor bitmap';
    case VicGraphicsMode.EXTENDED_COLOR_TEXT: return 'ECM text';
    default: return `illegal (${mode})`;
  }
}

function joystickCaptureFromValue(value: string): JoystickCapturePort {
  if (value === '1') return 1;
  if (value === '2') return 2;
  return null;
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

function mustSelect(id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Missing select #${id}.`);
  }
  return element;
}

function mustCanvas(id: string): HTMLCanvasElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error(`Missing canvas #${id}.`);
  }
  return element;
}

function must2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('2D canvas context is unavailable.');
  }
  return context;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hex(value: number, width: number): string {
  return (value >>> 0).toString(16).toUpperCase().padStart(width, '0');
}
