export type Mnemonic =
  | 'ADC' | 'AND' | 'ASL'
  | 'BCC' | 'BCS' | 'BEQ' | 'BIT' | 'BMI' | 'BNE' | 'BPL' | 'BRK' | 'BVC' | 'BVS'
  | 'CLC' | 'CLD' | 'CLI' | 'CLV'
  | 'CMP' | 'CPX' | 'CPY'
  | 'DEC' | 'DEX' | 'DEY'
  | 'EOR'
  | 'INC' | 'INX' | 'INY'
  | 'JMP' | 'JSR'
  | 'LDA' | 'LDX' | 'LDY' | 'LSR'
  | 'NOP'
  | 'ORA'
  | 'PHA' | 'PHP' | 'PLA' | 'PLP'
  | 'ROL' | 'ROR' | 'RTI' | 'RTS'
  | 'SBC' | 'SEC' | 'SED' | 'SEI'
  | 'STA' | 'STX' | 'STY'
  | 'TAX' | 'TAY' | 'TSX' | 'TXA' | 'TXS' | 'TYA'
  | 'ALR' | 'ANC' | 'ARR' | 'AXS'
  | 'DCP' | 'ISC' | 'JAM' | 'LAS' | 'LAX'
  | 'RLA' | 'RRA' | 'SAX' | 'SLO' | 'SRE'
  | 'AHX' | 'LXA' | 'SHX' | 'SHY' | 'TAS' | 'XAA';

export type AddressingMode =
  | 'IMP'
  | 'ACC'
  | 'IMM'
  | 'ZP'
  | 'ZPX'
  | 'ZPY'
  | 'ABS'
  | 'ABSX'
  | 'ABSY'
  | 'IND'
  | 'INDX'
  | 'INDY'
  | 'REL';

export type OpcodeStability = 'official' | 'stable-undocumented' | 'unstable-undocumented' | 'jam';

export interface OpcodeInfo {
  opcode: number;
  mnemonic: Mnemonic;
  mode: AddressingMode;
  bytes: number;
  cycles: number;
  pageCrossCycle: boolean;
  stability: OpcodeStability;
}

export interface CpuRegisters {
  a: number;
  x: number;
  y: number;
  sp: number;
  pc: number;
  status: number;
}

export interface CpuSnapshot extends CpuRegisters {
  cycles: number;
}
