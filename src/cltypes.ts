
// Types used by the CL Prompter
export type ParmValues = Record<string, any>;         // For all parameter values
export type QualPartsMap = Record<string, string[]>;  // For QUAL parameter parts

export interface CLParm {
  Kwd: string;
  Type: string;
  Max?: number;
  Min?: number;
  Dft?: string;
  Quals?: CLQual[];
  Elems?: CLElem[];
}

export interface CLQual {
  Type: string;
  Prompt?: string;
  Len?: number;
  Dft?: string;
  SpcVal?: string[];
}

export interface CLElem {
  Type: string;
  Prompt?: string;
  Len?: number;
  Dft?: string;
  Quals?: CLQual[];
  Elems?: CLElem[];
}