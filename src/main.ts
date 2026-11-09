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
  parseD64,
  parsePrg,
  type C64RomKind,
  type D64DirectoryEntry,
  type D64Image,
  type MonitorStopReason,
  type SidChipModel
} from './core';
import { SidAudio } from './audio/SidAudio';
import { HostInputController, type JoystickCapturePort } from './input/HostInputController';

const app = document.querySelector<HTMLElement>('#app');
if (app === null) {
  throw new Error('Missing #app element.');
}

export const machine = new C64Machine();
const sidAudio = new SidAudio(machine.bus.io.sid);
const traceLines: string[] = [];
let poweredOn = false;
let running = false;
let lastError = '';
let audioError = '';
let selectedPrg: { name: string; bytes: Uint8Array } | null = null;
let mountedD64: { name: string; image: D64Image; entries: readonly D64DirectoryEntry[] } | null = null;
let selectedD64Prg: D64DirectoryEntry | null = null;
let animationFrame: number | null = null;
let lastAnimationTime = 0;
let frameAccumulatorMs = 0;

app.innerHTML = `
  <section class="shell">
    <header>
      <p class="eyebrow">FROM-SCRATCH C64 EMULATOR</p>
      <h1>Commodore 64 Development Console</h1>
      <p>v0.14 — compatibility hardening: old-6526 timer/IRQ pipeline timing plus VIC-II register readback and 38-column border fidelity.</p>
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

    <article class="panel disk-panel">
      <div class="panel-heading">
        <div>
          <h2>D64 Disk Image</h2>
          <p>Browse a 1541 D64 and host-load PRGs directly. This accelerated path is intentionally separate from the physical IEC bus and is not 1541 emulation.</p>
        </div>
        <div id="d64-status" class="status-pill">No disk mounted</div>
      </div>
      <div class="disk-controls">
        <input id="d64-file" type="file" accept=".d64,application/octet-stream" />
        <label>
          PRG file
          <select id="d64-prg" disabled>
            <option value="">No PRG available</option>
          </select>
        </label>
        <button id="load-d64-prg" disabled>Host-assisted Load</button>
        <button id="run-d64-prg" disabled>Host-assisted Load + Jump</button>
      </div>
      <pre id="d64-directory" class="disk-directory">Mount a D64 to browse its directory.</pre>
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

    <article class="panel monitor-panel">
      <div class="panel-heading">
        <div>
          <h2>Machine Monitor</h2>
          <p>Execution stops are observational: guest memory is never patched with trap opcodes. Watch/raster hits finish the current 6510 instruction before edits are allowed.</p>
        </div>
        <div id="monitor-status" class="status-pill">Monitor ready</div>
      </div>

      <div class="monitor-controls">
        <fieldset>
          <legend>Execution stops</legend>
          <label>PC <input id="monitor-break-address" value="E000" maxlength="6" /></label>
          <button id="monitor-add-break">Add PC breakpoint</button>
          <label>Watch <input id="monitor-watch-address" value="0200" maxlength="6" /></label>
          <select id="monitor-watch-mode">
            <option value="readwrite">Read / write</option>
            <option value="read">Read</option>
            <option value="write">Write</option>
          </select>
          <button id="monitor-add-watch">Add watchpoint</button>
          <label>Raster line <input id="monitor-raster-line" value="0" inputmode="numeric" /></label>
          <label>cycle <input id="monitor-raster-cycle" placeholder="optional" inputmode="numeric" /></label>
          <button id="monitor-add-raster">Add raster stop</button>
          <label>ID <input id="monitor-remove-id" inputmode="numeric" /></label>
          <button id="monitor-remove-break">Remove</button>
          <button id="monitor-clear-breaks">Clear all</button>
          <button id="monitor-continue">Continue</button>
        </fieldset>

        <fieldset>
          <legend>CPU registers</legend>
          <label>PC <input id="monitor-reg-pc" maxlength="6" /></label>
          <label>A <input id="monitor-reg-a" maxlength="4" /></label>
          <label>X <input id="monitor-reg-x" maxlength="4" /></label>
          <label>Y <input id="monitor-reg-y" maxlength="4" /></label>
          <label>SP <input id="monitor-reg-sp" maxlength="4" /></label>
          <label>P <input id="monitor-reg-p" maxlength="4" /></label>
          <button id="monitor-apply-registers">Apply registers</button>
        </fieldset>

        <fieldset>
          <legend>Memory</legend>
          <label>View <input id="monitor-memory-address" value="0400" maxlength="6" /></label>
          <select id="monitor-memory-view">
            <option value="mapped">CPU-mapped</option>
            <option value="ram">Physical RAM</option>
          </select>
          <label>Write RAM <input id="monitor-write-address" value="0400" maxlength="6" /></label>
          <label>= <input id="monitor-write-value" value="00" maxlength="4" /></label>
          <button id="monitor-write-memory">Write byte</button>
          <button id="monitor-clear-history">Clear histories</button>
        </fieldset>
      </div>

      <pre id="monitor-breakpoints" class="monitor-breakpoints"></pre>
      <div class="monitor-grid">
        <section><h3>Memory dump</h3><pre id="monitor-memory"></pre></section>
        <section><h3>Execution history</h3><pre id="monitor-history"></pre></section>
        <section><h3>CPU / VIC bus trace</h3><pre id="monitor-bus-trace"></pre></section>
        <section><h3>IRQ / NMI history</h3><pre id="monitor-interrupts"></pre></section>
        <section><h3>Hardware snapshot</h3><pre id="monitor-hardware"></pre></section>
        <section><h3>Screen memory</h3><pre id="monitor-screen"></pre></section>
      </div>
      <div class="monitor-timeline-wrap">
        <h3>Raster / cycle access timeline</h3>
        <canvas id="monitor-timeline" width="900" height="150" aria-label="Recent CPU and VIC bus accesses by raster position"></canvas>
      </div>
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
const d64StatusElement = mustElement('d64-status');
const d64DirectoryElement = mustElement('d64-directory');
const monitorStatusElement = mustElement('monitor-status');
const monitorBreakpointsElement = mustElement('monitor-breakpoints');
const monitorMemoryElement = mustElement('monitor-memory');
const monitorHistoryElement = mustElement('monitor-history');
const monitorBusTraceElement = mustElement('monitor-bus-trace');
const monitorInterruptsElement = mustElement('monitor-interrupts');
const monitorHardwareElement = mustElement('monitor-hardware');
const monitorScreenElement = mustElement('monitor-screen');
const monitorTimelineCanvas = mustCanvas('monitor-timeline');
const monitorTimelineContext = must2dContext(monitorTimelineCanvas);
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
const d64Input = mustInput('d64-file');
const d64PrgSelect = mustSelect('d64-prg');
const loadD64PrgButton = mustButton('load-d64-prg');
const runD64PrgButton = mustButton('run-d64-prg');
const joystickSelect = mustSelect('joystick-capture');
const sidModelSelect = mustSelect('sid-model');
const audioEnableButton = mustButton('audio-enable');
const audioMuteButton = mustButton('audio-mute');

const monitorBreakAddressInput = mustInput('monitor-break-address');
const monitorAddBreakButton = mustButton('monitor-add-break');
const monitorWatchAddressInput = mustInput('monitor-watch-address');
const monitorWatchModeSelect = mustSelect('monitor-watch-mode');
const monitorAddWatchButton = mustButton('monitor-add-watch');
const monitorRasterLineInput = mustInput('monitor-raster-line');
const monitorRasterCycleInput = mustInput('monitor-raster-cycle');
const monitorAddRasterButton = mustButton('monitor-add-raster');
const monitorRemoveIdInput = mustInput('monitor-remove-id');
const monitorRemoveBreakButton = mustButton('monitor-remove-break');
const monitorClearBreaksButton = mustButton('monitor-clear-breaks');
const monitorContinueButton = mustButton('monitor-continue');
const monitorRegisterPcInput = mustInput('monitor-reg-pc');
const monitorRegisterAInput = mustInput('monitor-reg-a');
const monitorRegisterXInput = mustInput('monitor-reg-x');
const monitorRegisterYInput = mustInput('monitor-reg-y');
const monitorRegisterSpInput = mustInput('monitor-reg-sp');
const monitorRegisterPInput = mustInput('monitor-reg-p');
const monitorApplyRegistersButton = mustButton('monitor-apply-registers');
const monitorMemoryAddressInput = mustInput('monitor-memory-address');
const monitorMemoryViewSelect = mustSelect('monitor-memory-view');
const monitorWriteAddressInput = mustInput('monitor-write-address');
const monitorWriteValueInput = mustInput('monitor-write-value');
const monitorWriteMemoryButton = mustButton('monitor-write-memory');
const monitorClearHistoryButton = mustButton('monitor-clear-history');

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
  machine.monitor.resume();
  doStep();
  render();
});

run100Button.addEventListener('click', () => {
  if (!poweredOn) return;
  try {
    machine.monitor.resume();
    const executed = machine.run(100);
    traceLines.push(`RUN ${executed} instruction${executed === 1 ? '' : 's'}${machine.monitor.paused ? ' -> monitor stop' : ''}`);
    sidAudio.flush();
    lastError = '';
  } catch (error) {
    fail(error);
  }
  render();
});

runFrameButton.addEventListener('click', () => {
  if (!poweredOn) {
    return;
  }

  try {
    machine.monitor.resume();
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

d64Input.addEventListener('change', async () => {
  const file = d64Input.files?.[0];
  if (file === undefined) {
    clearMountedD64();
    updateControls();
    return;
  }
  await mountD64(file);
});

d64PrgSelect.addEventListener('change', () => {
  const selectedIndex = Number.parseInt(d64PrgSelect.value, 10);
  selectedD64Prg = mountedD64?.entries.find((entry) => entry.directoryIndex === selectedIndex && entry.fileType === 'PRG') ?? null;
  updateControls();
});

loadD64PrgButton.addEventListener('click', () => loadSelectedD64Prg(false));
runD64PrgButton.addEventListener('click', () => loadSelectedD64Prg(true));

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

monitorAddBreakButton.addEventListener('click', () => monitorAction(() => {
  const breakpoint = machine.monitor.addAddressBreakpoint(parseHexField(monitorBreakAddressInput, 'PC breakpoint'));
  monitorRemoveIdInput.value = String(breakpoint.id);
}));

monitorAddWatchButton.addEventListener('click', () => monitorAction(() => {
  const mode = monitorWatchModeSelect.value;
  if (mode !== 'read' && mode !== 'write' && mode !== 'readwrite') {
    throw new Error(`Unknown watchpoint mode: ${mode}.`);
  }
  const watchpoint = machine.monitor.addWatchpoint(parseHexField(monitorWatchAddressInput, 'watchpoint'), mode);
  monitorRemoveIdInput.value = String(watchpoint.id);
}));

monitorAddRasterButton.addEventListener('click', () => monitorAction(() => {
  const line = parseDecimalField(monitorRasterLineInput, 'raster line');
  const cycleText = monitorRasterCycleInput.value.trim();
  const cycle = cycleText === '' ? null : parseDecimalField(monitorRasterCycleInput, 'raster cycle');
  const breakpoint = machine.monitor.addRasterBreakpoint(line, cycle);
  monitorRemoveIdInput.value = String(breakpoint.id);
}));

monitorRemoveBreakButton.addEventListener('click', () => monitorAction(() => {
  const id = parseDecimalField(monitorRemoveIdInput, 'breakpoint ID');
  if (!machine.monitor.removeBreakpoint(id)) {
    throw new Error(`No monitor breakpoint/watchpoint with ID ${id}.`);
  }
}));

monitorClearBreaksButton.addEventListener('click', () => monitorAction(() => {
  machine.monitor.clearBreakpoints();
}));

monitorContinueButton.addEventListener('click', () => {
  if (!poweredOn) return;
  setRunning(true);
  updateControls();
  render();
});

monitorApplyRegistersButton.addEventListener('click', () => monitorAction(() => {
  requirePausedMonitorEdit();
  machine.monitor.setCpuRegisters({
    pc: parseHexField(monitorRegisterPcInput, 'PC'),
    a: parseHexField(monitorRegisterAInput, 'A'),
    x: parseHexField(monitorRegisterXInput, 'X'),
    y: parseHexField(monitorRegisterYInput, 'Y'),
    sp: parseHexField(monitorRegisterSpInput, 'SP'),
    status: parseHexField(monitorRegisterPInput, 'P')
  });
}));

monitorWriteMemoryButton.addEventListener('click', () => monitorAction(() => {
  requirePausedMonitorEdit();
  machine.monitor.writeMemory(
    parseHexField(monitorWriteAddressInput, 'memory address'),
    parseHexField(monitorWriteValueInput, 'memory value'),
    'ram'
  );
}));

monitorClearHistoryButton.addEventListener('click', () => monitorAction(() => {
  machine.monitor.clearHistory();
  traceLines.length = 0;
}));

monitorMemoryAddressInput.addEventListener('change', render);
monitorMemoryViewSelect.addEventListener('change', render);

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
clearMountedD64();
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
  if (next && poweredOn) {
    machine.monitor.resume();
  }
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
      if (machine.monitor.paused) {
        setRunning(false);
        break;
      }
      frameAccumulatorMs -= frameDurationMs;
      frames += 1;
    }

    if (frames > 0 || machine.monitor.paused) sidAudio.flush();

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

async function mountD64(file: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = parseD64(bytes);
    const entries = image.listDirectory();
    mountedD64 = { name: file.name, image, entries };
    selectedD64Prg = entries.find((entry) => entry.fileType === 'PRG') ?? null;
    lastError = '';
    renderD64Directory();
  } catch (error) {
    clearMountedD64();
    lastError = errorMessage(error);
  }

  updateControls();
  render();
}

function clearMountedD64(): void {
  mountedD64 = null;
  selectedD64Prg = null;
  d64StatusElement.textContent = 'No disk mounted';
  d64StatusElement.title = '';
  d64StatusElement.classList.remove('ready');
  d64DirectoryElement.textContent = 'Mount a D64 to browse its directory.';
  d64PrgSelect.replaceChildren(new Option('No PRG available', ''));
  d64PrgSelect.disabled = true;
}

function renderD64Directory(): void {
  if (mountedD64 === null) {
    clearMountedD64();
    return;
  }

  const { image, entries, name } = mountedD64;
  const geometry = image.geometry;
  const diskName = image.header.name === '' ? '(unnamed)' : image.header.name;
  d64StatusElement.textContent = `${diskName} · ${geometry.tracks} tracks · ${entries.length} files`;
  d64StatusElement.title = `${name}${image.header.id === '' ? '' : ` · ID ${image.header.id}`}`;
  d64StatusElement.classList.add('ready');

  d64DirectoryElement.textContent = entries.length === 0
    ? 'Directory is empty.'
    : entries.map((entry) => formatD64DirectoryEntry(entry)).join('\n');

  const prgs = entries.filter((entry) => entry.fileType === 'PRG');
  d64PrgSelect.replaceChildren();
  if (prgs.length === 0) {
    d64PrgSelect.add(new Option('No PRG files', ''));
    d64PrgSelect.disabled = true;
    selectedD64Prg = null;
    return;
  }

  for (const entry of prgs) {
    d64PrgSelect.add(new Option(`${entry.filename} (${entry.blocks} blocks)`, String(entry.directoryIndex)));
  }
  d64PrgSelect.disabled = false;
  const selected = selectedD64Prg ?? prgs[0]!;
  selectedD64Prg = selected;
  d64PrgSelect.value = String(selected.directoryIndex);
}

function loadSelectedD64Prg(jumpToLoadAddress: boolean): void {
  if (!poweredOn || mountedD64 === null || selectedD64Prg === null) {
    return;
  }

  try {
    const bytes = mountedD64.image.readPrg(selectedD64Prg);
    const result = machine.loadPrg(bytes);
    const prefix = `D64 HOST LOAD "${selectedD64Prg.filename}" -> $${hex(result.loadAddress, 4)}-$${hex(result.endAddressExclusive - 1, 4)}`;

    if (jumpToLoadAddress) {
      machine.startAt(result.loadAddress);
      traceLines.push(`${prefix}; PC=$${hex(result.loadAddress, 4)}`);
      setRunning(true);
    } else {
      traceLines.push(prefix + (result.basicPointersInitialized ? ' (BASIC pointers updated)' : ''));
    }

    lastError = '';
    vicCanvas.focus();
  } catch (error) {
    fail(error);
  }

  updateControls();
  render();
}

function formatD64DirectoryEntry(entry: D64DirectoryEntry): string {
  const blocks = String(entry.blocks).padStart(4, ' ');
  const flags = `${entry.closed ? ' ' : '*'}${entry.locked ? '<' : ' '}`;
  return `${blocks}  "${entry.filename}" ${entry.fileType}${flags}`;
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


function monitorAction(action: () => void): void {
  try {
    action();
    lastError = '';
  } catch (error) {
    lastError = errorMessage(error);
  }
  updateControls();
  render();
}

function requirePausedMonitorEdit(): void {
  if (!poweredOn) throw new Error('Power on the C64 before editing machine state.');
  if (running) throw new Error('Pause execution before editing registers or memory.');
}

function renderMonitor(): void {
  const monitor = machine.monitor;
  const stop = monitor.stopReason;
  monitorStatusElement.textContent = !poweredOn
    ? 'Power off'
    : running
      ? 'Running'
      : stop === null
        ? 'Paused at instruction boundary'
        : formatMonitorStop(stop);
  monitorStatusElement.classList.toggle('ready', poweredOn && !running);

  const breakpointLines = [
    ...monitor.addressBreakpoints.map((breakpoint) =>
      `#${breakpoint.id} PC     $${hex(breakpoint.address, 4)} ${breakpoint.enabled ? 'enabled' : 'disabled'}`),
    ...monitor.watchpoints.map((watchpoint) => {
      const range = watchpoint.startAddress === watchpoint.endAddress
        ? `$${hex(watchpoint.startAddress, 4)}`
        : `$${hex(watchpoint.startAddress, 4)}-$${hex(watchpoint.endAddress, 4)}`;
      return `#${watchpoint.id} WATCH  ${range} ${watchpoint.mode} ${watchpoint.enabled ? 'enabled' : 'disabled'}`;
    }),
    ...monitor.rasterBreakpoints.map((breakpoint) =>
      `#${breakpoint.id} RASTER ${breakpoint.rasterLine}:${breakpoint.rasterCycle ?? '*'} ${breakpoint.enabled ? 'enabled' : 'disabled'}`)
  ].sort((left, right) => Number.parseInt(left.slice(1), 10) - Number.parseInt(right.slice(1), 10));
  monitorBreakpointsElement.textContent = breakpointLines.length > 0
    ? breakpointLines.join('\n')
    : 'No breakpoints or watchpoints configured.';

  if (!poweredOn) {
    monitorMemoryElement.textContent = 'Power on to inspect memory.';
    monitorHistoryElement.textContent = 'No execution history.';
    monitorBusTraceElement.textContent = 'No bus trace.';
    monitorInterruptsElement.textContent = 'No interrupt history.';
    monitorHardwareElement.textContent = 'Power on to inspect hardware.';
    monitorScreenElement.textContent = 'Power on to inspect screen memory.';
    monitorTimelineContext.clearRect(0, 0, monitorTimelineCanvas.width, monitorTimelineCanvas.height);
    return;
  }

  syncMonitorRegisterInputs();

  const memoryAddress = tryParseHexField(monitorMemoryAddressInput) ?? machine.cpu.pc;
  const view = monitorMemoryViewSelect.value === 'ram' ? 'ram' : 'mapped';
  const memory = monitor.readMemory(memoryAddress, 128, view);
  monitorMemoryElement.textContent = formatMemoryDump(memoryAddress, memory);

  monitorHistoryElement.textContent = monitor.executionHistory.length === 0
    ? 'No completed instruction boundaries recorded.'
    : monitor.executionHistory.slice(-18).map((entry) =>
        `$${hex(entry.pc, 4)} ${entry.instruction.padEnd(18, ' ')} A:${hex(entry.a, 2)} X:${hex(entry.x, 2)} Y:${hex(entry.y, 2)} ` +
        `F${entry.frame} ${entry.rasterLine}:${entry.rasterCycle} M:${entry.masterCycle}`
      ).join('\n');

  monitorBusTraceElement.textContent = monitor.busTrace.length === 0
    ? 'No CPU/VIC bus activity recorded.'
    : monitor.busTrace.slice(-22).map((entry) =>
        `${entry.source === 'cpu' ? 'CPU' : 'VIC'} ${entry.kind === 'read' ? 'R' : 'W'} $${hex(entry.address, 4)} ` +
        `$${hex(entry.value, 2)}  F${entry.frame} ${entry.rasterLine}:${entry.rasterCycle} M:${entry.masterCycle}`
      ).join('\n');

  monitorInterruptsElement.textContent = monitor.interruptHistory.length === 0
    ? 'No IRQ/NMI edges recorded.'
    : monitor.interruptHistory.slice(-16).map((entry) =>
        `${entry.kind} ${entry.asserted ? 'ASSERT' : 'CLEAR '} [${entry.sources.join('+') || '-'}] ` +
        `PC:$${hex(entry.pc, 4)} F${entry.frame} ${entry.rasterLine}:${entry.rasterCycle} M:${entry.masterCycle}`
      ).join('\n');

  const hardware = monitor.hardwareSnapshot();
  monitorHardwareElement.textContent = [
    `CPU PC/A/X/Y  $${hex(hardware.cpu.pc, 4)} / $${hex(hardware.cpu.a, 2)} / $${hex(hardware.cpu.x, 2)} / $${hex(hardware.cpu.y, 2)}`,
    `CPU SP/P      $${hex(hardware.cpu.sp, 2)} / $${hex(hardware.cpu.status, 2)}`,
    `MASTER/STALL  ${hardware.masterCycle} / ${hardware.cpuStallCycles}`,
    '',
    `VIC F/L/C     ${hardware.vic.frame} / ${hardware.vic.rasterLine} / ${hardware.vic.rasterCycle}`,
    `VIC IRQ/BA/AEC ${bit(hardware.vic.irqAsserted)} / ${bit(hardware.vic.baHigh)} / ${bit(hardware.vic.aecHigh)}`,
    `VIC SCREEN    $${hex(hardware.vic.screenAddress, 4)}`,
    `VIC CHAR/BMP  $${hex(hardware.vic.characterAddress, 4)} / $${hex(hardware.vic.bitmapAddress, 4)}`,
    '',
    `CIA1 TA/TB    $${hex(hardware.cia1.timerA, 4)} / $${hex(hardware.cia1.timerB, 4)}`,
    `CIA1 ICR/MASK $${hex(hardware.cia1.interruptFlags, 2)} / $${hex(hardware.cia1.interruptMask, 2)}`,
    `CIA2 TA/TB    $${hex(hardware.cia2.timerA, 4)} / $${hex(hardware.cia2.timerB, 4)}`,
    `CIA2 ICR/MASK $${hex(hardware.cia2.interruptFlags, 2)} / $${hex(hardware.cia2.interruptMask, 2)}`,
    '',
    `SID MODEL     ${hardware.sid.model}`,
    `SID FC        ${Math.round(hardware.sid.filterCutoffHz)} Hz`,
    `SID ENV       ${hardware.sid.envelopeLevels.map((value) => hex(value, 2)).join(' / ')}`,
    `PORT DDR/LAT  $${hex(hardware.processorPort.ddr, 2)} / $${hex(hardware.processorPort.latch, 2)}`
  ].join('\n');

  const screen = monitor.screenMemorySnapshot();
  monitorScreenElement.textContent = [
    `Screen RAM $${hex(screen.address, 4)}  Color RAM $D800`,
    ...Array.from({ length: 10 }, (_, row) => {
      const start = row * 40;
      const chars = Array.from(screen.characters.slice(start, start + 40))
        .map((value) => hex(value, 2)).join(' ');
      return `${String(row).padStart(2, '0')}: ${chars}`;
    }),
    '… first 10 of 25 rows shown'
  ].join('\n');

  renderMonitorTimeline();
}

function syncMonitorRegisterInputs(): void {
  const cpu = machine.cpu;
  syncInputUnlessFocused(monitorRegisterPcInput, hex(cpu.pc, 4));
  syncInputUnlessFocused(monitorRegisterAInput, hex(cpu.a, 2));
  syncInputUnlessFocused(monitorRegisterXInput, hex(cpu.x, 2));
  syncInputUnlessFocused(monitorRegisterYInput, hex(cpu.y, 2));
  syncInputUnlessFocused(monitorRegisterSpInput, hex(cpu.sp, 2));
  syncInputUnlessFocused(monitorRegisterPInput, hex(cpu.status, 2));
}

function syncInputUnlessFocused(input: HTMLInputElement, value: string): void {
  if (document.activeElement !== input) input.value = value;
}

function renderMonitorTimeline(): void {
  const context = monitorTimelineContext;
  const width = monitorTimelineCanvas.width;
  const height = monitorTimelineCanvas.height;
  const vic = machine.bus.io.vic;
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#111118';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#3c3c50';
  context.strokeRect(0.5, 0.5, width - 1, height - 1);

  const trace = machine.monitor.busTrace.slice(-300);
  for (const entry of trace) {
    const x = ((entry.rasterCycle - 1) / Math.max(1, vic.timing.cyclesPerLine - 1)) * (width - 1);
    const y = (entry.rasterLine / Math.max(1, vic.timing.linesPerFrame - 1)) * (height - 1);
    context.fillStyle = entry.source === 'cpu' ? '#9ecbff' : '#f4bf75';
    context.fillRect(Math.round(x), Math.round(y), 2, 2);
  }

  const currentX = ((vic.rasterCycle - 1) / Math.max(1, vic.timing.cyclesPerLine - 1)) * (width - 1);
  const currentY = (vic.rasterLine / Math.max(1, vic.timing.linesPerFrame - 1)) * (height - 1);
  context.strokeStyle = '#d4d4e3';
  context.beginPath();
  context.moveTo(currentX - 4, currentY);
  context.lineTo(currentX + 4, currentY);
  context.moveTo(currentX, currentY - 4);
  context.lineTo(currentX, currentY + 4);
  context.stroke();
}

function formatMonitorStop(stop: MonitorStopReason): string {
  switch (stop.type) {
    case 'manual': return stop.message;
    case 'address': return `Stopped: PC $${hex(stop.address, 4)} (#${stop.breakpointId})`;
    case 'watchpoint': return `Stopped: ${stop.access.kind} $${hex(stop.access.address, 4)} (#${stop.watchpointId})`;
    case 'raster': return `Stopped: raster ${stop.rasterLine}:${stop.rasterCycle} (#${stop.breakpointId})`;
  }
}

function formatMemoryDump(address: number, bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.slice(offset, offset + 16);
    lines.push(`$${hex((address + offset) & 0xffff, 4)}  ${Array.from(row).map((value) => hex(value, 2)).join(' ')}`);
  }
  return lines.join('\n');
}

function parseHexField(input: HTMLInputElement, label: string): number {
  const value = tryParseHexField(input);
  if (value === null) throw new Error(`${label} must be a hexadecimal value.`);
  return value;
}

function tryParseHexField(input: HTMLInputElement): number | null {
  const normalized = input.value.trim().replace(/^\$/, '').replace(/^0x/i, '');
  if (!/^[0-9a-f]+$/i.test(normalized)) return null;
  const value = Number.parseInt(normalized, 16);
  return Number.isFinite(value) ? value : null;
}

function parseDecimalField(input: HTMLInputElement, label: string): number {
  const normalized = input.value.trim();
  if (!/^\d+$/.test(normalized)) throw new Error(`${label} must be a decimal integer.`);
  return Number.parseInt(normalized, 10);
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
    `IEC A/C/D      ${iecLine(machine.bus.iec.atnHigh)} / ${iecLine(machine.bus.iec.clockHigh)} / ${iecLine(machine.bus.iec.dataHigh)}`,
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

  renderMonitor();
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
  loadD64PrgButton.disabled = !poweredOn || mountedD64 === null || selectedD64Prg === null;
  runD64PrgButton.disabled = !poweredOn || mountedD64 === null || selectedD64Prg === null;
  monitorApplyRegistersButton.disabled = !poweredOn || running;
  monitorWriteMemoryButton.disabled = !poweredOn || running;
  monitorContinueButton.disabled = !poweredOn || running;
  monitorClearHistoryButton.disabled = !poweredOn;
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

function iecLine(high: boolean): string {
  return high ? 'HIGH' : 'LOW';
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
