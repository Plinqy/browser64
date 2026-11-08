import type { AddressingMode, Mnemonic, OpcodeInfo, OpcodeStability } from './types';

const table: Array<OpcodeInfo | undefined> = new Array<OpcodeInfo | undefined>(256);

function op(
  opcode: number,
  mnemonic: Mnemonic,
  mode: AddressingMode,
  bytes: number,
  cycles: number,
  pageCrossCycle = false,
  stability: OpcodeStability = 'official'
): void {
  table[opcode] = { opcode, mnemonic, mode, bytes, cycles, pageCrossCycle, stability };
}

function uop(
  opcode: number,
  mnemonic: Mnemonic,
  mode: AddressingMode,
  bytes: number,
  cycles: number,
  pageCrossCycle = false
): void {
  op(opcode, mnemonic, mode, bytes, cycles, pageCrossCycle, 'stable-undocumented');
}

function jam(opcode: number): void {
  op(opcode, 'JAM', 'IMP', 1, 2, false, 'jam');
}

function unstable(
  opcode: number,
  mnemonic: Mnemonic,
  mode: AddressingMode,
  bytes: number,
  cycles: number
): void {
  op(opcode, mnemonic, mode, bytes, cycles, false, 'unstable-undocumented');
}

// 0x00
op(0x00, 'BRK', 'IMP', 1, 7);
op(0x01, 'ORA', 'INDX', 2, 6);
op(0x05, 'ORA', 'ZP', 2, 3);
op(0x06, 'ASL', 'ZP', 2, 5);
op(0x08, 'PHP', 'IMP', 1, 3);
op(0x09, 'ORA', 'IMM', 2, 2);
op(0x0a, 'ASL', 'ACC', 1, 2);
op(0x0d, 'ORA', 'ABS', 3, 4);
op(0x0e, 'ASL', 'ABS', 3, 6);

// 0x10
op(0x10, 'BPL', 'REL', 2, 2);
op(0x11, 'ORA', 'INDY', 2, 5, true);
op(0x15, 'ORA', 'ZPX', 2, 4);
op(0x16, 'ASL', 'ZPX', 2, 6);
op(0x18, 'CLC', 'IMP', 1, 2);
op(0x19, 'ORA', 'ABSY', 3, 4, true);
op(0x1d, 'ORA', 'ABSX', 3, 4, true);
op(0x1e, 'ASL', 'ABSX', 3, 7);

// 0x20
op(0x20, 'JSR', 'ABS', 3, 6);
op(0x21, 'AND', 'INDX', 2, 6);
op(0x24, 'BIT', 'ZP', 2, 3);
op(0x25, 'AND', 'ZP', 2, 3);
op(0x26, 'ROL', 'ZP', 2, 5);
op(0x28, 'PLP', 'IMP', 1, 4);
op(0x29, 'AND', 'IMM', 2, 2);
op(0x2a, 'ROL', 'ACC', 1, 2);
op(0x2c, 'BIT', 'ABS', 3, 4);
op(0x2d, 'AND', 'ABS', 3, 4);
op(0x2e, 'ROL', 'ABS', 3, 6);

// 0x30
op(0x30, 'BMI', 'REL', 2, 2);
op(0x31, 'AND', 'INDY', 2, 5, true);
op(0x35, 'AND', 'ZPX', 2, 4);
op(0x36, 'ROL', 'ZPX', 2, 6);
op(0x38, 'SEC', 'IMP', 1, 2);
op(0x39, 'AND', 'ABSY', 3, 4, true);
op(0x3d, 'AND', 'ABSX', 3, 4, true);
op(0x3e, 'ROL', 'ABSX', 3, 7);

// 0x40
op(0x40, 'RTI', 'IMP', 1, 6);
op(0x41, 'EOR', 'INDX', 2, 6);
op(0x45, 'EOR', 'ZP', 2, 3);
op(0x46, 'LSR', 'ZP', 2, 5);
op(0x48, 'PHA', 'IMP', 1, 3);
op(0x49, 'EOR', 'IMM', 2, 2);
op(0x4a, 'LSR', 'ACC', 1, 2);
op(0x4c, 'JMP', 'ABS', 3, 3);
op(0x4d, 'EOR', 'ABS', 3, 4);
op(0x4e, 'LSR', 'ABS', 3, 6);

// 0x50
op(0x50, 'BVC', 'REL', 2, 2);
op(0x51, 'EOR', 'INDY', 2, 5, true);
op(0x55, 'EOR', 'ZPX', 2, 4);
op(0x56, 'LSR', 'ZPX', 2, 6);
op(0x58, 'CLI', 'IMP', 1, 2);
op(0x59, 'EOR', 'ABSY', 3, 4, true);
op(0x5d, 'EOR', 'ABSX', 3, 4, true);
op(0x5e, 'LSR', 'ABSX', 3, 7);

// 0x60
op(0x60, 'RTS', 'IMP', 1, 6);
op(0x61, 'ADC', 'INDX', 2, 6);
op(0x65, 'ADC', 'ZP', 2, 3);
op(0x66, 'ROR', 'ZP', 2, 5);
op(0x68, 'PLA', 'IMP', 1, 4);
op(0x69, 'ADC', 'IMM', 2, 2);
op(0x6a, 'ROR', 'ACC', 1, 2);
op(0x6c, 'JMP', 'IND', 3, 5);
op(0x6d, 'ADC', 'ABS', 3, 4);
op(0x6e, 'ROR', 'ABS', 3, 6);

// 0x70
op(0x70, 'BVS', 'REL', 2, 2);
op(0x71, 'ADC', 'INDY', 2, 5, true);
op(0x75, 'ADC', 'ZPX', 2, 4);
op(0x76, 'ROR', 'ZPX', 2, 6);
op(0x78, 'SEI', 'IMP', 1, 2);
op(0x79, 'ADC', 'ABSY', 3, 4, true);
op(0x7d, 'ADC', 'ABSX', 3, 4, true);
op(0x7e, 'ROR', 'ABSX', 3, 7);

// 0x80
op(0x81, 'STA', 'INDX', 2, 6);
op(0x84, 'STY', 'ZP', 2, 3);
op(0x85, 'STA', 'ZP', 2, 3);
op(0x86, 'STX', 'ZP', 2, 3);
op(0x88, 'DEY', 'IMP', 1, 2);
op(0x8a, 'TXA', 'IMP', 1, 2);
op(0x8c, 'STY', 'ABS', 3, 4);
op(0x8d, 'STA', 'ABS', 3, 4);
op(0x8e, 'STX', 'ABS', 3, 4);

// 0x90
op(0x90, 'BCC', 'REL', 2, 2);
op(0x91, 'STA', 'INDY', 2, 6);
op(0x94, 'STY', 'ZPX', 2, 4);
op(0x95, 'STA', 'ZPX', 2, 4);
op(0x96, 'STX', 'ZPY', 2, 4);
op(0x98, 'TYA', 'IMP', 1, 2);
op(0x99, 'STA', 'ABSY', 3, 5);
op(0x9a, 'TXS', 'IMP', 1, 2);
op(0x9d, 'STA', 'ABSX', 3, 5);

// 0xA0
op(0xa0, 'LDY', 'IMM', 2, 2);
op(0xa1, 'LDA', 'INDX', 2, 6);
op(0xa2, 'LDX', 'IMM', 2, 2);
op(0xa4, 'LDY', 'ZP', 2, 3);
op(0xa5, 'LDA', 'ZP', 2, 3);
op(0xa6, 'LDX', 'ZP', 2, 3);
op(0xa8, 'TAY', 'IMP', 1, 2);
op(0xa9, 'LDA', 'IMM', 2, 2);
op(0xaa, 'TAX', 'IMP', 1, 2);
op(0xac, 'LDY', 'ABS', 3, 4);
op(0xad, 'LDA', 'ABS', 3, 4);
op(0xae, 'LDX', 'ABS', 3, 4);

// 0xB0
op(0xb0, 'BCS', 'REL', 2, 2);
op(0xb1, 'LDA', 'INDY', 2, 5, true);
op(0xb4, 'LDY', 'ZPX', 2, 4);
op(0xb5, 'LDA', 'ZPX', 2, 4);
op(0xb6, 'LDX', 'ZPY', 2, 4);
op(0xb8, 'CLV', 'IMP', 1, 2);
op(0xb9, 'LDA', 'ABSY', 3, 4, true);
op(0xba, 'TSX', 'IMP', 1, 2);
op(0xbc, 'LDY', 'ABSX', 3, 4, true);
op(0xbd, 'LDA', 'ABSX', 3, 4, true);
op(0xbe, 'LDX', 'ABSY', 3, 4, true);

// 0xC0
op(0xc0, 'CPY', 'IMM', 2, 2);
op(0xc1, 'CMP', 'INDX', 2, 6);
op(0xc4, 'CPY', 'ZP', 2, 3);
op(0xc5, 'CMP', 'ZP', 2, 3);
op(0xc6, 'DEC', 'ZP', 2, 5);
op(0xc8, 'INY', 'IMP', 1, 2);
op(0xc9, 'CMP', 'IMM', 2, 2);
op(0xca, 'DEX', 'IMP', 1, 2);
op(0xcc, 'CPY', 'ABS', 3, 4);
op(0xcd, 'CMP', 'ABS', 3, 4);
op(0xce, 'DEC', 'ABS', 3, 6);

// 0xD0
op(0xd0, 'BNE', 'REL', 2, 2);
op(0xd1, 'CMP', 'INDY', 2, 5, true);
op(0xd5, 'CMP', 'ZPX', 2, 4);
op(0xd6, 'DEC', 'ZPX', 2, 6);
op(0xd8, 'CLD', 'IMP', 1, 2);
op(0xd9, 'CMP', 'ABSY', 3, 4, true);
op(0xdd, 'CMP', 'ABSX', 3, 4, true);
op(0xde, 'DEC', 'ABSX', 3, 7);

// 0xE0
op(0xe0, 'CPX', 'IMM', 2, 2);
op(0xe1, 'SBC', 'INDX', 2, 6);
op(0xe4, 'CPX', 'ZP', 2, 3);
op(0xe5, 'SBC', 'ZP', 2, 3);
op(0xe6, 'INC', 'ZP', 2, 5);
op(0xe8, 'INX', 'IMP', 1, 2);
op(0xe9, 'SBC', 'IMM', 2, 2);
op(0xea, 'NOP', 'IMP', 1, 2);
op(0xec, 'CPX', 'ABS', 3, 4);
op(0xed, 'SBC', 'ABS', 3, 4);
op(0xee, 'INC', 'ABS', 3, 6);

// 0xF0
op(0xf0, 'BEQ', 'REL', 2, 2);
op(0xf1, 'SBC', 'INDY', 2, 5, true);
op(0xf5, 'SBC', 'ZPX', 2, 4);
op(0xf6, 'INC', 'ZPX', 2, 6);
op(0xf8, 'SED', 'IMP', 1, 2);
op(0xf9, 'SBC', 'ABSY', 3, 4, true);
op(0xfd, 'SBC', 'ABSX', 3, 4, true);
op(0xfe, 'INC', 'ABSX', 3, 7);

// Stable NMOS 6502/6510 undocumented instructions. These opcodes are real
// decode-matrix combinations used by C64 software and demos. The unstable
// bus-conflict family is decoded below for disassembly but deliberately not
// executed without a chip/bus-specific model.

// SLO = ASL memory, then ORA.
uop(0x03, 'SLO', 'INDX', 2, 8); uop(0x07, 'SLO', 'ZP', 2, 5);
uop(0x0f, 'SLO', 'ABS', 3, 6); uop(0x13, 'SLO', 'INDY', 2, 8);
uop(0x17, 'SLO', 'ZPX', 2, 6); uop(0x1b, 'SLO', 'ABSY', 3, 7);
uop(0x1f, 'SLO', 'ABSX', 3, 7);

// RLA = ROL memory, then AND.
uop(0x23, 'RLA', 'INDX', 2, 8); uop(0x27, 'RLA', 'ZP', 2, 5);
uop(0x2f, 'RLA', 'ABS', 3, 6); uop(0x33, 'RLA', 'INDY', 2, 8);
uop(0x37, 'RLA', 'ZPX', 2, 6); uop(0x3b, 'RLA', 'ABSY', 3, 7);
uop(0x3f, 'RLA', 'ABSX', 3, 7);

// SRE = LSR memory, then EOR.
uop(0x43, 'SRE', 'INDX', 2, 8); uop(0x47, 'SRE', 'ZP', 2, 5);
uop(0x4f, 'SRE', 'ABS', 3, 6); uop(0x53, 'SRE', 'INDY', 2, 8);
uop(0x57, 'SRE', 'ZPX', 2, 6); uop(0x5b, 'SRE', 'ABSY', 3, 7);
uop(0x5f, 'SRE', 'ABSX', 3, 7);

// RRA = ROR memory, then ADC.
uop(0x63, 'RRA', 'INDX', 2, 8); uop(0x67, 'RRA', 'ZP', 2, 5);
uop(0x6f, 'RRA', 'ABS', 3, 6); uop(0x73, 'RRA', 'INDY', 2, 8);
uop(0x77, 'RRA', 'ZPX', 2, 6); uop(0x7b, 'RRA', 'ABSY', 3, 7);
uop(0x7f, 'RRA', 'ABSX', 3, 7);

// SAX and LAX.
uop(0x83, 'SAX', 'INDX', 2, 6); uop(0x87, 'SAX', 'ZP', 2, 3);
uop(0x8f, 'SAX', 'ABS', 3, 4); uop(0x97, 'SAX', 'ZPY', 2, 4);
uop(0xa3, 'LAX', 'INDX', 2, 6); uop(0xa7, 'LAX', 'ZP', 2, 3);
uop(0xaf, 'LAX', 'ABS', 3, 4); uop(0xb3, 'LAX', 'INDY', 2, 5, true);
uop(0xb7, 'LAX', 'ZPY', 2, 4); uop(0xbf, 'LAX', 'ABSY', 3, 4, true);

// DCP = DEC memory, then CMP; ISC = INC memory, then SBC.
uop(0xc3, 'DCP', 'INDX', 2, 8); uop(0xc7, 'DCP', 'ZP', 2, 5);
uop(0xcf, 'DCP', 'ABS', 3, 6); uop(0xd3, 'DCP', 'INDY', 2, 8);
uop(0xd7, 'DCP', 'ZPX', 2, 6); uop(0xdb, 'DCP', 'ABSY', 3, 7);
uop(0xdf, 'DCP', 'ABSX', 3, 7);
uop(0xe3, 'ISC', 'INDX', 2, 8); uop(0xe7, 'ISC', 'ZP', 2, 5);
uop(0xef, 'ISC', 'ABS', 3, 6); uop(0xf3, 'ISC', 'INDY', 2, 8);
uop(0xf7, 'ISC', 'ZPX', 2, 6); uop(0xfb, 'ISC', 'ABSY', 3, 7);
uop(0xff, 'ISC', 'ABSX', 3, 7);

// Immediate combinations and the stable LAS/SBC aliases.
uop(0x0b, 'ANC', 'IMM', 2, 2); uop(0x2b, 'ANC', 'IMM', 2, 2);
uop(0x4b, 'ALR', 'IMM', 2, 2); uop(0x6b, 'ARR', 'IMM', 2, 2);
uop(0xcb, 'AXS', 'IMM', 2, 2); uop(0xbb, 'LAS', 'ABSY', 3, 4, true);
uop(0xeb, 'SBC', 'IMM', 2, 2);

// Undocumented NOPs perform their real operand/dummy reads.
for (const opcode of [0x1a, 0x3a, 0x5a, 0x7a, 0xda, 0xfa]) uop(opcode, 'NOP', 'IMP', 1, 2);
for (const opcode of [0x80, 0x82, 0x89, 0xc2, 0xe2]) uop(opcode, 'NOP', 'IMM', 2, 2);
for (const opcode of [0x04, 0x44, 0x64]) uop(opcode, 'NOP', 'ZP', 2, 3);
for (const opcode of [0x14, 0x34, 0x54, 0x74, 0xd4, 0xf4]) uop(opcode, 'NOP', 'ZPX', 2, 4);
uop(0x0c, 'NOP', 'ABS', 3, 4);
for (const opcode of [0x1c, 0x3c, 0x5c, 0x7c, 0xdc, 0xfc]) uop(opcode, 'NOP', 'ABSX', 3, 4, true);

// JAM/KIL stops the NMOS core until RESET.
for (const opcode of [0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2]) jam(opcode);

// These decode on real NMOS parts but depend on internal/bus conflict details
// that vary with silicon and page crossing. Decode them for a correct listing,
// but refuse to fabricate deterministic execution semantics.
unstable(0x8b, 'XAA', 'IMM', 2, 2);
unstable(0xab, 'LXA', 'IMM', 2, 2);
unstable(0x93, 'AHX', 'INDY', 2, 6);
unstable(0x9f, 'AHX', 'ABSY', 3, 5);
unstable(0x9b, 'TAS', 'ABSY', 3, 5);
unstable(0x9c, 'SHY', 'ABSX', 3, 5);
unstable(0x9e, 'SHX', 'ABSY', 3, 5);

export const OPCODES: ReadonlyArray<OpcodeInfo | undefined> = table;

export const OFFICIAL_OPCODE_COUNT = table.filter((entry) => entry?.stability === 'official').length;
export const IMPLEMENTED_OPCODE_COUNT = table.filter((entry) => entry !== undefined && entry.stability !== 'unstable-undocumented').length;
export const UNSTABLE_OPCODE_COUNT = table.filter((entry) => entry?.stability === 'unstable-undocumented').length;

export function getOpcodeInfo(opcode: number): OpcodeInfo | undefined {
  return table[opcode & 0xff];
}
