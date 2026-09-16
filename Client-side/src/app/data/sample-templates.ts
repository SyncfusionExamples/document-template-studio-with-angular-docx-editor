// Merge field catalog, blank-template seed, and the .NET backend URL live
// here. Port of Client-side/src/data/sampleTemplates.js.

// ---------------------------------------------------------------------------
// Backend Web API base URL.
//
// Local .NET server (Server-side / Program.cs) started with `dotnet run`,
// listening on http://localhost:5212/. Every cross-origin call from the
// Angular app — including the editor's own Import/Save/MailMerge path —
// targets `${DOCUMENT_EDITOR_BASE_URL}/api/DocumentEditor/`.
export const DOCUMENT_EDITOR_BASE_URL = 'http://localhost:5212';

// Full Service URL the Syncfusion DocumentEditor container needs in its
// `serviceUrl` prop (note trailing slash — that's what the editor expects).
export const DOCUMENT_EDITOR_SERVICE_URL =
  `${DOCUMENT_EDITOR_BASE_URL}/api/DocumentEditor/`;

// ---------------------------------------------------------------------------
// Merge field catalog. Maps a unique `FieldName` to true (the key IS the
// field name). Templates reference field names in their `fieldKeys` array.
// ---------------------------------------------------------------------------
export const MERGE_FIELDS: Record<string, boolean> = {
  // Donor / recipient
  DonorName: true,
  DonorAddress: true,
  DonorEmail: true,

  // Donation
  DonationAmount: true,
  DonationDate: true,
  PaymentMethod: true,
  ReceiptNumber: true,

  // Invoice / Pledge specifics
  CustomerID: true,
  OrderID: true,
  InvoiceDate: true,

  // Tax / receipt
  TaxYear: true,
  TaxID: true,
  DeductibleAmount: true,

  // Organization
  OrgName: true,
  OrgAddress: true,
  OrgPhone: true,
  OrgEmail: true,
};

// Seeded merge fields for "+ New Template".
export const NEW_TEMPLATE_FIELD_KEYS: string[] = [
  'OrgName',
  'OrgAddress',
  'DonorName',
  'DonorAddress',
  'DonationAmount',
  'DonationDate',
];

// ---------------------------------------------------------------------------
// Shared shape definitions.
// ---------------------------------------------------------------------------
export interface Tpl {
  id: string;
  name: string;
  type: string;
  description?: string;
  fieldKeys?: string[];
  docxUrl?: string;
  thumbnailUrl?: string;
  updatedAt?: string;
  seedLines?: unknown;
}

export type CommonFields = Record<string, boolean | unknown>;