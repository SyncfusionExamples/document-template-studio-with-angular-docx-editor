// Port of Client-side/src/utils/studioStorage.js.
// All metadata operations talk directly to the ASP.NET Core StudioController.

import { DOCUMENT_EDITOR_BASE_URL } from '../data/sample-templates';
import { Injectable } from '@angular/core';

const DOC_EDITOR_IMPORT_URL = `${DOCUMENT_EDITOR_BASE_URL}/api/DocumentEditor/Import`;
const DOC_EDITOR_IMPORT_FILE_URL = `${DOCUMENT_EDITOR_BASE_URL}/api/DocumentEditor/ImportFileURL`;
const DOC_EDITOR_SAVE_URL = `${DOCUMENT_EDITOR_BASE_URL}/api/DocumentEditor/Save`;
const DOC_EDITOR_MAILMERGE_URL = `${DOCUMENT_EDITOR_BASE_URL}/api/DocumentEditor/MailMerge`;

const STUDIO_API = `${DOCUMENT_EDITOR_BASE_URL}/api/studio`;

// ---------------------------------------------------------------------------
// Document editor storage
// ---------------------------------------------------------------------------
export interface SfdtImportResult {
  sfdt: string;
  mergeFields: string[];
}

export async function fetchSfdtFromDocx(opts: {
  file?: File;
  url?: string;
  name?: string;
}): Promise<SfdtImportResult> {
  const { file, url, name } = opts;
  if (file) {
    const baseName = (name || file.name || 'template')
      .replace(/\.docx$/i, '')
      .trim();
    const fd = new FormData();
    fd.append('docx', file, file.name || 'template.docx');
    if (baseName) fd.append('FileName', baseName);

    const res = await fetch(DOC_EDITOR_IMPORT_URL, {
      method: 'POST',
      body: fd,
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new Error(
        `Import failed (${res.status})${detail ? `: ${detail.slice(0, 240)}` : ''}`,
      );
    }
    const responseText = await res.text();
    if (!responseText) throw new Error('Import returned an empty document.');
    return { sfdt: responseText, mergeFields: [] };
  }

  if (url) {
    const res = await fetch(DOC_EDITOR_IMPORT_FILE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify({ fileUrl: url }),
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch {
        /* ignore */
      }
      throw new Error(
        `ImportFileURL failed (${res.status})${detail ? `: ${detail.slice(0, 240)}` : ''}`,
      );
    }
    const raw = await res.text();
    if (!raw) throw new Error('ImportFileURL returned an empty document.');
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof parsed.sfdt === 'string') {
        return {
          sfdt: parsed.sfdt,
          mergeFields: Array.isArray(parsed.mergeFields) ? parsed.mergeFields : [],
        };
      }
    } catch {
      // not JSON - fall through
    }
    return { sfdt: raw, mergeFields: [] };
  }

  throw new Error('fetchSfdtFromDocx: file or url required');
}

function stripDocxExtension(name: string | undefined): string {
  if (!name) return 'Document';
  return String(name).replace(/\.docx$/i, '').trim() || 'Document';
}

export async function saveTemplateToServer(opts: {
  sfdtContent: string;
  documentName: string;
  format?: string;
}) {
  if (!opts.sfdtContent) {
    throw new Error('saveTemplateToServer: sfdtContent is required');
  }
  const fileName = stripDocxExtension(opts.documentName);
  const payload = {
    Content: opts.sfdtContent,
    FileName: fileName,
    Format: opts.format || 'Docx',
  };
  const res = await fetch(DOC_EDITOR_SAVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `Save failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }
  return { ok: true, fileName, format: payload.Format };
}

export async function mailMergePreview(opts: {
  fileName: string;
  documentData: string;
  mailMergeData: string;
}): Promise<string> {
  if (!opts.documentData) {
    throw new Error('mailMergePreview: documentData (base64) is required');
  }
  if (!opts.mailMergeData) {
    throw new Error('mailMergePreview: mailMergeData (JSON string) is required');
  }
  const safeFileName = (opts.fileName || 'Document.docx').endsWith('.docx')
    ? opts.fileName || 'Document.docx'
    : `${(opts.fileName || 'Document').replace(/\.docx$/i, '')}.docx`;
  const payload = {
    fileName: safeFileName,
    documentData: opts.documentData,
    mailMergeData: opts.mailMergeData,
  };
  const res = await fetch(DOC_EDITOR_MAILMERGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(payload),
  });
  if (res.status === 200) {
    const sfdt = await res.text();
    if (!sfdt) throw new Error('Mail merge returned an empty document.');
    return sfdt;
  }
  let detail = '';
  try {
    detail = await res.text();
  } catch {
    /* ignore */
  }
  throw new Error(
    `Mail merge failed (${res.status})${detail ? `: ${detail.slice(0, 240)}` : ''}`,
  );
}

export function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// Server-side catalog + common-fields API.
// ---------------------------------------------------------------------------
export async function fetchTemplatesCatalog<T = unknown>(): Promise<T[]> {
  try {
    const res = await fetch(`${STUDIO_API}/catalog`);
    if (!res.ok) return [];
    const json = await res.json();
    if (!Array.isArray(json)) return [];
    return json as T[];
  } catch {
    return [];
  }
}

export async function saveTemplatesCatalog(catalog: unknown) {
  const res = await fetch(`${STUDIO_API}/catalog`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(catalog),
  });
  if (!res.ok) throw new Error(`Catalog save failed (${res.status})`);
  return res.json();
}

export async function uploadTemplate(opts: {
  file: File;
  name?: string;
  type?: string;
  description?: string;
}) {
  const fd = new FormData();
  fd.append('file', opts.file, opts.file.name || 'template.docx');
  if (opts.name) fd.append('name', opts.name);
  if (opts.type) fd.append('type', opts.type);
  if (opts.description) fd.append('description', opts.description);
  const res = await fetch(`${STUDIO_API}/upload`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `Upload failed (${res.status})${detail ? `: ${detail.slice(0, 240)}` : ''}`,
    );
  }
  return res.json();
}

export async function deleteTemplate(id: string) {
  const res = await fetch(`${STUDIO_API}/template/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `Delete failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }
  return res.json().catch(() => ({ ok: true }));
}

// ---------------------------------------------------------------------------
// Hidden built-in templates (client-side filter persisted to localStorage).
// ---------------------------------------------------------------------------
const HIDDEN_BUILTINS_KEY = 'studio.hiddenBuiltInTemplates';

function readHiddenBuiltIns(): string[] {
  try {
    const raw = window.localStorage.getItem(HIDDEN_BUILTINS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === 'string');
  } catch {
    return [];
  }
}

function writeHiddenBuiltIns(ids: string[]) {
  try {
    window.localStorage.setItem(HIDDEN_BUILTINS_KEY, JSON.stringify(ids));
  } catch {
    /* best-effort */
  }
}

export function getHiddenBuiltInIds(): string[] {
  return readHiddenBuiltIns();
}

export function hideBuiltInTemplate(id: string): string[] {
  const current = readHiddenBuiltIns();
  if (current.includes(id)) return current;
  const next = [...current, id];
  writeHiddenBuiltIns(next);
  return next;
}

// ---------------------------------------------------------------------------
// Custom merge fields
// ---------------------------------------------------------------------------
export interface AddCustomMergeFieldResult {
  ok: boolean;
  key: string;
  field: unknown;
  fieldKeys?: string[] | null;
}

export async function addCustomMergeField(opts: {
  scope: 'template' | 'common';
  templateId?: string;
  templateName?: string;
  templateType?: string;
  templateDescription?: string;
  key: string;
}): Promise<AddCustomMergeFieldResult> {
  const fd = new FormData();
  fd.append('scope', opts.scope);
  if (opts.templateId) fd.append('templateId', opts.templateId);
  if (opts.templateName) fd.append('templateName', opts.templateName);
  if (opts.templateType) fd.append('templateType', opts.templateType);
  if (opts.templateDescription)
    fd.append('templateDescription', opts.templateDescription);
  fd.append('key', opts.key);
  const res = await fetch(`${STUDIO_API}/mergefield`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Add field failed (${res.status})`);
  }
  const json = (await res.json()) as AddCustomMergeFieldResult;
  if (!json.ok) throw new Error((json as unknown as { error?: string }).error || 'Add field failed');
  return json;
}

export async function fetchCommonMergeFields(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${STUDIO_API}/common-fields`);
    if (!res.ok) return {};
    const json = await res.json();
    return (json as { fields?: Record<string, unknown> }).fields || {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Helper used by App to derive an absolute URL for a stored docxUrl.
// ---------------------------------------------------------------------------
export function absoluteDocxUrl(docxUrl?: string): string {
  if (!docxUrl) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(docxUrl)) return docxUrl;
  if (docxUrl.startsWith('/')) {
    return `${DOCUMENT_EDITOR_BASE_URL}${docxUrl}`;
  }
  return `${DOCUMENT_EDITOR_BASE_URL}/Templates/${docxUrl}`;
}

// Helper used by App to generate a unique id for new (blank) templates.
export function makeId(prefix = 'tpl'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

@Injectable({ providedIn: 'root' })
export class StudioStorageFacade {
  // This facade is intentionally tiny — Angular components can call the
  // top-level functions in this module directly. We keep this class so
  // DI consumers (DialogService, etc.) can request studio operations in
  // a future iteration without restructuring import sites.
}