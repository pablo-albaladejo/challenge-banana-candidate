/** An internal procedure document, in every version the corpus holds. */
export type ProcedureDocument = {
  id: string;
  title: string;
  version: number;
  validFrom: string;
  validTo: string | null;
};
/** The internal procedures a brief may cite. Wired to `knowledge().listDocuments`. */
export type ProcedureCatalog = { procedures(): ProcedureDocument[] };
