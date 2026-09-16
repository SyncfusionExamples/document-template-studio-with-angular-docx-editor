import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  OnChanges,
  SimpleChanges,
  OnDestroy,
  ChangeDetectorRef,
  ViewChild,
  AfterViewInit,
  signal,
  computed,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  DocumentEditorContainerComponent,
  DocumentEditorContainerModule,
  RibbonService,
  ToolbarService,
} from '@syncfusion/ej2-angular-documenteditor';
import { ButtonModule } from '@syncfusion/ej2-angular-buttons';

import {
  Tpl,
  MERGE_FIELDS,
  DOCUMENT_EDITOR_SERVICE_URL,
} from '../../data/sample-templates';
import {
  fetchSfdtFromDocx,
  saveTemplateToServer,
  mailMergePreview,
  readBlobAsDataUrl,
} from '../../utils/studio-storage';
import { MergeFieldsPanelComponent } from '../merge-fields-panel/merge-fields-panel';

// Editors we use the JS-class API on top of the Angular wrapper.
type EditorApi = {
  open(sfdt: string): void;
  openBlank(): void;
  serialize(): string;
  save(fileName: string, formatType: string): void;
  saveAsBlob(formatType: string): Promise<Blob>;
  exportAsImage(pageIndex: number, format: string): HTMLImageElement | null;
  pageCount: number;
  isReadOnly?: boolean;
  restrictEditing?: boolean;
  focusIn(): void;
  documentName?: string;
  selection?: {
    select(coords: { x: number; y: number; extend?: boolean }): void;
  };
  documentEditorSettings?: { printDevicePixelRatio?: number };
  // The Angular wrapper actually nests the editor under
  // `<wrapper>.documentEditor.editor` for the document-command surface.
  // We keep the helper available so `insertField` finds it.
  editor?: { insertField(fieldCode: string, resultText: string): void };
};

type EditorContainer = {
  documentEditor: EditorApi;
  element?: HTMLElement;
};

// Capture page 1 of the LIVE DocumentEditor as a data URI PNG.
function captureThumbnailFromEditor(
  container: EditorContainer | null | undefined,
  settleMs = 500,
): Promise<string> {
  return new Promise((resolve) => {
    if (!container || typeof container.documentEditor?.exportAsImage !== 'function') {
      resolve('');
      return;
    }
    const de = container.documentEditor;
    de.documentEditorSettings = de.documentEditorSettings || {};
    de.documentEditorSettings.printDevicePixelRatio = 2;
    setTimeout(() => {
      let img: HTMLImageElement | null = null;
      try {
        img = de.exportAsImage(1, 'image/png');
      } catch {
        resolve('');
        return;
      }
      if (!img || !img.src) {
        resolve('');
        return;
      }
      img.onload = () => resolve(img!.src);
      img.onerror = () => resolve('');
      if (img.complete) resolve(img.src);
    }, settleMs);
  });
}

const PREVIEW_EXAMPLE_JSON = `{
  "Organization": [
    {
      "OrgName": "ABC Foundation",
      "OrgAddress": "123 Main Street, New York, NY 10001",
      "DonorName": "John Smith",
      "DonorAddress": "45 Oak Street, New York, NY 10002",
      "DonationAmount": "$1,500.00",
      "DonationDate": "August 15, 2026"
    }
  ]
}`;

@Component({
  selector: 'app-template-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    DocumentEditorContainerModule,
    ButtonModule,
    MergeFieldsPanelComponent,
  ],
  providers: [RibbonService, ToolbarService],
  templateUrl: './template-viewer.html',
  styleUrl: './template-viewer.css',
})
export class TemplateViewerComponent
  implements OnChanges, OnDestroy, AfterViewInit
{
  @Input() template: Tpl | null = null;
  @Input() initialUploadFile: File | null = null;
  @Input() commonFields: Record<string, unknown> = {};

  @Output() back = new EventEmitter<void>();
  @Output() thumbnailUpdated = new EventEmitter<{
    id: string;
    dataUri: string;
  }>();
  @Output() initialUploadSaved = new EventEmitter<{
    templateId: string;
    thumbnailDataUri: string;
    pageCount: number;
  }>();
  @Output() initialUploadFailed = new EventEmitter<Error>();
  @Output() commonFieldAdded = new EventEmitter<{
    key: string;
    field: unknown;
  }>();
  @Output() templateFieldKeyAdded = new EventEmitter<{
    templateId: string;
    newFieldKeys: string[];
  }>();
  @Output() requestPublish = new EventEmitter<Tpl>();
  @Output() saved = new EventEmitter<{ templateId: string; name: string }>();

  // The reference to the Syncfusion Angular wrapper. We then grab
  // `<wrapper>.documentEditor` for the JS-class API (open, serialize, ...).
  @ViewChild(DocumentEditorContainerComponent)
  editorRef?: DocumentEditorContainerComponent;

  @ViewChild('previewFileInput')
  previewFileInput?: ElementRef<HTMLInputElement>;

  dirty = signal(false);
  isSaving = signal(false);
  isMerging = signal(false);
  isDownloading = signal(false);

  // Doc-only merge fields returned from ImportFileURL
  documentMergeFields = signal<string[]>([]);
  customFieldMap = signal<Record<string, unknown>>({});

  combinedCustomFields = computed<Record<string, unknown>>(() => {
    const tplScoped: Record<string, unknown> = {};
    if (this.template && Array.isArray(this.template.fieldKeys)) {
      for (const k of this.template.fieldKeys) tplScoped[k] = true;
    }
    return {
      ...tplScoped,
      ...this.commonFields,
      ...this.customFieldMap(),
    };
  });

  // ----------------- preview-with-data state -----------------
  previewOpen = signal(false);
  previewFileName = signal('');
  previewError = signal('');
  previewInternalFile = signal<{ parsed: unknown; file: File } | null>(null);

  // Drag-drop overlay state
  isDragOver = signal(false);

  // gate programmatic loads so contentChange doesn't mark dirty
  private isLoadingFlag = false;
  private dragDepth = 0;

  protected readonly MERGE_FIELDS = MERGE_FIELDS;
  protected readonly DOCUMENT_EDITOR_SERVICE_URL = DOCUMENT_EDITOR_SERVICE_URL;

  constructor(private cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    // no-op; the Syncfusion editor fires `created` itself which is
    // bound to onEditorCreated below. We do nothing here intentionally.
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['template']) {
      const tpl = this.template;
      this.dirty.set(false);
      if (tpl) {
        const seed: Record<string, boolean> = {};
        if (Array.isArray(tpl.fieldKeys)) {
          for (const k of tpl.fieldKeys) if (!MERGE_FIELDS[k]) seed[k] = true;
        }
        this.customFieldMap.set(seed);
      }
      this.documentMergeFields.set([]);
    }
    if (changes['initialUploadFile']) {
      // The initial load is triggered inside onEditorCreated when the
      // Syncfusion editor fully boots and we have the JS-class handle.
    }
    if (changes['commonFields']) {
      this.cdr.markForCheck();
    }
  }

  ngOnDestroy(): void {
    // nothing to clean
  }

  // ----------------- editor lifecycle hooks -----------------
  onEditorCreated(): void {
    const wrapper = this.editorRef;
    if (!wrapper) return;
    const de = wrapper.documentEditor;
    if (!de) return;

    const tpl = this.template;
    if (!tpl) return;

    de.isReadOnly = false;
    (de as { restrictEditing?: boolean }).restrictEditing = false;

    this.dirty.set(false);
    this.loadTemplateIntoEditor(tpl, this.initialUploadFile);
  }

  onContentChange(): void {
    if (this.isLoadingFlag) return;
    this.dirty.set(true);
  }

  private getEditorHandle(): EditorContainer | null {
    const wrapper = this.editorRef;
    if (!wrapper) return null;
    return wrapper as unknown as EditorContainer;
  }

  private async loadTemplateIntoEditor(tpl: Tpl, uploadedFile: File | null) {
    const wrapper = this.getEditorHandle();
    if (!wrapper) return;
    const de = wrapper.documentEditor;
    if (!de) return;

    this.isLoadingFlag = true;

    // Case 1: brand new upload (file present, no docxUrl on disk yet)
    if (uploadedFile && !tpl.docxUrl) {
      const baseName = (tpl.name || '')
        .replace(/\.docx$/i, '')
        .trim();
      try {
        const { sfdt } = await fetchSfdtFromDocx({
          file: uploadedFile,
          name: baseName,
        });
        de.open(sfdt);
        await this.initializeUploadedTemplate(tpl);
      } catch (err) {
        this.isLoadingFlag = false;
        this.initialUploadFailed.emit(
          err instanceof Error ? err : new Error(String(err)),
        );
      }
      return;
    }

    // Case 2: existing persisted template, load .docx from server.
    if (tpl.docxUrl) {
      const baseName = (tpl.name || '')
        .replace(/\.docx$/i, '')
        .trim();
      try {
        const { sfdt, mergeFields } = await fetchSfdtFromDocx({
          url: tpl.docxUrl,
          name: baseName,
        });
        this.documentMergeFields.set(
          Array.isArray(mergeFields) ? [...mergeFields] : [],
        );
        de.open(sfdt);
        this.isLoadingFlag = false;

        // If also uploaded, capture thumbnail
        if (uploadedFile) {
          try {
            await wait(500);
            const thumbnailDataUri = await captureThumbnailFromEditor(wrapper);
            if (thumbnailDataUri) {
              const pageCount = Number(de.pageCount) || 0;
              this.initialUploadSaved.emit({
                templateId: tpl.id,
                thumbnailDataUri,
                pageCount,
              });
            }
          } catch (err) {
            console.warn('thumbnail capture failed:', err);
          }
        }
      } catch (err) {
        console.error('DOCX import failed:', err);
        try {
          de.openBlank();
        } catch {
          /* ignore */
        }
        this.isLoadingFlag = false;
      }
    } else {
      // Case 3: blank "+ New Template"
      try {
        de.openBlank();
      } catch {
        /* ignore */
      }
      this.isLoadingFlag = false;
    }
  }

  private async initializeUploadedTemplate(tpl: Tpl) {
    const wrapper = this.getEditorHandle();
    if (!wrapper) return;
    await wait(500);
    let thumbnailDataUri = '';
    try {
      thumbnailDataUri = await captureThumbnailFromEditor(wrapper);
    } catch (err) {
      this.isLoadingFlag = false;
      this.initialUploadFailed.emit(
        new Error(
          `Thumbnail generation failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
      return;
    }
    if (!thumbnailDataUri) {
      this.isLoadingFlag = false;
      this.initialUploadFailed.emit(
        new Error('Thumbnail generation returned no image data.'),
      );
      return;
    }
    const pageCount = Number(wrapper.documentEditor.pageCount) || 0;
    this.initialUploadSaved.emit({
      templateId: tpl.id,
      thumbnailDataUri,
      pageCount,
    });
    this.dirty.set(false);
    this.isLoadingFlag = false;
    this.cdr.markForCheck();
  }

  // ----------------- merge fields -----------------
  onInsertField(key: string) {
    const wrapper = this.getEditorHandle();
    if (!wrapper) return;
    const de = wrapper.documentEditor;
    const defs = this.combinedCustomFields();
    const f = MERGE_FIELDS[key] || defs[key];
    const fieldName = (key || '')
      .replace(/\n/g, '')
      .replace(/\r/g, '')
      .replace(/\r\n/g, '');
    const fieldCode = `MERGEFIELD  ${fieldName}  \\* MERGEFORMAT `;
    de.focusIn();
    // Syncfusion exposes `insertField` directly on DocumentEditor
    // (older Angular wrappers exposed it on the inner `.editor`).
    // We try both so the call works regardless of wrapper version.
    const insertTarget =
      (de as unknown as { editor?: { insertField?: (...args: unknown[]) => void } }).editor ??
      (de as unknown as { insertField?: (...args: unknown[]) => void });
    const fn = insertTarget.insertField;
    if (typeof fn === 'function') {
      fn.call(insertTarget, fieldCode, `\u00ab${fieldName}\u00bb`);
    } else {
      // Fallback: editor API exposes insertField on itself in newer wrappers.
      throw new Error('DocumentEditor.insertField is not available in this build.');
    }
  }

  onCustomFieldAdded(info: {
    scope: 'template' | 'common';
    key: string;
    field: unknown;
    fieldKeys?: string[] | null;
    templateId: string | null;
  }) {
    this.customFieldMap.update((prev) => ({ ...prev, [info.key]: info.field }));
    if (info.scope === 'common') {
      this.commonFieldAdded.emit({ key: info.key, field: info.field });
    }
    if (
      info.scope === 'template' &&
      Array.isArray(info.fieldKeys) &&
      this.template
    ) {
      this.templateFieldKeyAdded.emit({
        templateId: this.template.id,
        newFieldKeys: info.fieldKeys,
      });
    }
  }

  // ----------------- drag-and-drop -----------------
  private isMergeFieldDrag(dt: DataTransfer | null | undefined): boolean {
    if (!dt || !dt.types) return false;
    const types = Array.from(dt.types);
    return types.includes('application/x-ts-mergefield')
      || types.includes('application/json');
  }

  private readMergeFieldKey(dt: DataTransfer): string | null {
    try {
      const envelope = dt.getData('application/json');
      if (envelope) {
        const parsed = JSON.parse(envelope);
        if (
          parsed &&
          parsed.source === 'merge-fields-panel' &&
          typeof parsed.key === 'string'
        ) {
          return parsed.key;
        }
      }
    } catch {
      /* fall through */
    }
    const dedicated = dt.getData('application/x-ts-mergefield');
    if (dedicated) return dedicated;
    if (this.isMergeFieldDrag(dt)) return dt.getData('text/plain');
    return null;
  }

  onCanvasDragEnter(ev: DragEvent) {
    if (!this.isMergeFieldDrag(ev.dataTransfer)) return;
    ev.preventDefault();
    this.dragDepth += 1;
    this.isDragOver.set(true);
  }
  onCanvasDragOver(ev: DragEvent) {
    if (!this.isMergeFieldDrag(ev.dataTransfer)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
  }
  onCanvasDragLeave(ev: DragEvent) {
    if (!this.isMergeFieldDrag(ev.dataTransfer)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.isDragOver.set(false);
  }
  onCanvasDrop(ev: DragEvent) {
    if (!this.isMergeFieldDrag(ev.dataTransfer)) return;
    ev.preventDefault();
    ev.stopPropagation();
    this.dragDepth = 0;
    this.isDragOver.set(false);
    const key = this.readMergeFieldKey(ev.dataTransfer!);
    if (!key) return;
    try {
      const wrapper = this.getEditorHandle();
      const de = wrapper?.documentEditor;
      if (de && typeof de.focusIn === 'function') de.focusIn();
      if (
        wrapper &&
        wrapper.element &&
        de?.selection?.select &&
        typeof de.selection.select === 'function'
      ) {
        const dropX = ev.clientX;
        const dropY = ev.clientY;
        const rootEl = wrapper.element;
        const candidates = [
          '.e-de-viewer',
          '.e-de-page-content',
          '.e-de-page-container',
          '.e-de-scroll-container',
          '.e-documenteditor',
          '.e-documenteditor-content',
          '.e-documenteditor-container',
        ];
        let viewer: Element | null = null;
        for (const sel of candidates) {
          const el = rootEl.querySelector
            ? (rootEl.querySelector(sel) as Element | null)
            : null;
          if (!el || !el.getBoundingClientRect) continue;
          const r = el.getBoundingClientRect();
          if (
            r.width > 0 &&
            r.height > 0 &&
            dropX >= r.left &&
            dropX <= r.right &&
            dropY >= r.top &&
            dropY <= r.bottom
          ) {
            viewer = el;
            break;
          }
        }
        if (!viewer) {
          const all = rootEl.querySelectorAll ? rootEl.querySelectorAll('*') : [];
          let bestArea = -1;
          for (let i = 0; i < all.length; i++) {
            const el = all[i] as Element;
            if (!el || !el.getBoundingClientRect) continue;
            const r = el.getBoundingClientRect();
            if (
              r.width > 0 &&
              r.height > 0 &&
              dropX >= r.left &&
              dropX <= r.right &&
              dropY >= r.top &&
              dropY <= r.bottom
            ) {
              const area = r.width * r.height;
              if (area > bestArea) {
                bestArea = area;
                viewer = el;
              }
            }
          }
        }
        if (!viewer) viewer = rootEl;
        const rect = viewer.getBoundingClientRect();
        const localX = dropX - rect.left;
        const localY = dropY - rect.top;
        let sLeft = 0;
        let sTop = 0;
        try {
          const v = viewer as HTMLElement;
          if (typeof v.scrollLeft === 'number' && v.scrollLeft !== 0) {
            sLeft = v.scrollLeft;
          } else {
            let p: HTMLElement | null = v.parentElement;
            while (p && !(p.scrollLeft || p.scrollTop)) {
              p = p.parentElement;
            }
            if (p) {
              sLeft = p.scrollLeft || 0;
              sTop = p.scrollTop || 0;
            }
          }
        } catch {
          /* ignore */
        }
        const finalX = Math.max(0, localX + sLeft);
        const finalY = Math.max(0, localY + sTop);
        de!.selection!.select({
          x: finalX,
          y: finalY,
          extend: false,
        });
      }
    } catch (selErr) {
      console.warn('Drop caret placement failed; using existing caret:', selErr);
    }
    try {
      this.onInsertField(key);
    } catch (err) {
      console.error('Drop-insert failed:', err);
    }
  }

  // ----------------- save / download -----------------
  async onSave() {
    if (!this.template) return;
    if (!this.template.docxUrl) {
      this.requestPublish.emit(this.template);
      return;
    }
    await this.runSaveFlow();
  }

  // Called by the App's Publish dialog to drive the actual save +
  // thumbnail capture + dirty clear. Mirrors the React
  // `publishExecuteRef` flow.
  async onSavePublish(opts: {
    name: string;
    category: string;
  }): Promise<{ docxBaseName: string; thumbnailDataUri: string }> {
    if (!this.template) throw new Error('Template is not loaded.');
    const wrapper = this.getEditorHandle();
    if (!wrapper) throw new Error('Editor is not ready.');
    const de = wrapper.documentEditor;

    let sfdt = '';
    try {
      sfdt = de.serialize();
    } catch (err) {
      throw new Error('Could not serialize the document. Please try again.');
    }
    if (!sfdt) throw new Error('Document serialized to an empty payload.');

    const base = (opts.name || this.template.name || 'template')
      .replace(/\.[^.]+$/, '')
      .trim();
    const slug =
      `${base.replace(/[^A-Za-z0-9-_]+/g, '_').replace(/^_+|_+$/g, '') || 'template'}-${Date.now().toString(36)}`;
    const saveResult = await saveTemplateToServer({
      sfdtContent: sfdt,
      documentName: slug,
      format: 'Docx',
    });
    console.log(
      `[studio] "${this.template.name}" published via DocumentEditorController.Save -> ${saveResult.fileName}.docx`,
    );

    let thumbnailDataUri = '';
    try {
      thumbnailDataUri = await captureThumbnailFromEditor(wrapper);
    } catch (err) {
      console.warn('thumbnail refresh failed:', err);
    }
    this.dirty.set(false);
    return {
      docxBaseName: (saveResult as { fileName?: string }).fileName || slug,
      thumbnailDataUri,
    };
  }

  private async runSaveFlow() {
    const wrapper = this.getEditorHandle();
    if (!wrapper) return;
    const de = wrapper.documentEditor;
    this.isSaving.set(true);
    try {
      let sfdt = '';
      try {
        sfdt = de.serialize();
      } catch (err) {
        throw new Error('Could not serialize the document. Please try again.');
      }
      if (!sfdt) throw new Error('Document serialized to an empty payload.');

      const docxBaseName = (() => {
        if (this.template!.docxUrl) {
          const tail = this.template!.docxUrl.split('/').pop() || '';
          return tail.replace(/\.docx$/i, '').trim();
        }
        const base = (this.template!.name || 'template').replace(/\.[^.]+$/, '').trim();
        return (
          base.replace(/[^A-Za-z0-9-_]+/g, '_').replace(/^_+|_+$/g, '') ||
          'template'
        );
      })();

      await saveTemplateToServer({
        sfdtContent: sfdt,
        documentName: docxBaseName,
        format: 'Docx',
      });

      let thumbnailDataUri = '';
      try {
        thumbnailDataUri = await captureThumbnailFromEditor(wrapper);
      } catch (err) {
        console.warn('thumbnail refresh failed:', err);
      }

      const tplId = this.template!.id;
      const tplName = this.template!.name;

      if (thumbnailDataUri) {
        this.thumbnailUpdated.emit({
          id: tplId,
          dataUri: thumbnailDataUri,
        });
      }

      this.dirty.set(false);
      this.saved.emit({ templateId: tplId, name: tplName });
    } catch (err) {
      console.error('Save failed:', err);
      alert(
        `Save failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.isSaving.set(false);
    }
  }

  async onDownload() {
    if (!this.template) return;
    const wrapper = this.getEditorHandle();
    if (!wrapper) return;
    this.isDownloading.set(true);
    try {
      let baseName = this.template.name?.trim() || 'Document';
      if (!this.template.name) {
        baseName =
          (this.template.name || 'template')
            .replace(/\.[^.]+$/, '')
            .trim()
            .replace(/[^A-Za-z0-9-_]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'Document';
      }
      wrapper.documentEditor.save(baseName, 'Docx');
    } catch (err) {
      console.error('Download failed:', err);
      alert(
        `Download failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      setTimeout(() => this.isDownloading.set(false), 800);
    }
  }

  // ----------------- preview-with-data (Mail Merge) -----------------
  onPreviewClick() {
    this.previewFileName.set('');
    this.previewError.set('');
    this.previewInternalFile.set(null);
    this.previewOpen.set(true);
  }

  onPreviewClose() {
    if (this.isMerging()) return;
    this.previewOpen.set(false);
    this.previewError.set('');
  }

  onPreviewBrowseClick() {
    this.previewFileInput?.nativeElement.click();
  }

  async onPreviewFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    if (!file) {
      this.previewInternalFile.set(null);
      this.previewFileName.set('');
      return;
    }
    const lower = (file.name || '').toLowerCase();
    if (!lower.endsWith('.json')) {
      this.previewInternalFile.set(null);
      this.previewFileName.set('');
      this.previewError.set('Please choose a .json file.');
      input.value = '';
      return;
    }
    this.previewError.set('');
    try {
      const text = await file.text();
      const parsed = text.trim() ? JSON.parse(text) : null;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.previewInternalFile.set(null);
        this.previewFileName.set('');
        this.previewError.set(
          'The .json file must contain a JSON object (not an array or scalar). See the example format.',
        );
        input.value = '';
        return;
      }
      const firstKey = Object.keys(parsed)[0];
      if (!firstKey || !Array.isArray(parsed[firstKey])) {
        this.previewInternalFile.set(null);
        this.previewFileName.set('');
        this.previewError.set(
          'The JSON object must have at least one array property, e.g. { "Organization": [ { ... } ] }. See the example format.',
        );
        input.value = '';
        return;
      }
      this.previewInternalFile.set({ parsed, file });
      this.previewFileName.set(file.name);
    } catch (err) {
      this.previewInternalFile.set(null);
      this.previewFileName.set('');
      this.previewError.set(
        `Could not read JSON file: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      input.value = '';
    }
  }

  async onPreviewOk() {
    const wrapper = this.getEditorHandle();
    if (!wrapper || !this.template) return;
    const de = wrapper.documentEditor;
    const internal = this.previewInternalFile();
    if (!internal) {
      this.previewError.set('Please browse for a .json data file first.');
      return;
    }
    const parsed = internal.parsed;
    this.isMerging.set(true);
    this.previewError.set('');
    try {
      const blob = await de.saveAsBlob('Docx');
      const dataUrl = await readBlobAsDataUrl(blob);
      const docName = (de.documentName || '').trim()
        || (this.template!.docxUrl
          ? this.template!.docxUrl
              .split('/')
              .pop()
              ?.replace(/\.docx$/i, '')
          : this.template!.name) || 'Document';
      const mergedSfdt = await mailMergePreview({
        fileName: `${docName}.docx`,
        documentData: dataUrl,
        mailMergeData: JSON.stringify(parsed),
      });
      de.open(mergedSfdt);
      this.dirty.set(false);
      this.previewOpen.set(false);
      this.previewInternalFile.set(null);
      this.previewFileName.set('');
      if (this.previewFileInput) this.previewFileInput.nativeElement.value = '';
    } catch (err) {
      this.previewError.set(
        err instanceof Error ? err.message : String(err) || 'Mail merge failed.',
      );
    } finally {
      this.isMerging.set(false);
    }
  }

  protected readonly PREVIEW_EXAMPLE_JSON = PREVIEW_EXAMPLE_JSON;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}