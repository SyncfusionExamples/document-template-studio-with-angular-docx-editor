import {
  Component,
  signal,
  computed,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ViewChild,
  ElementRef,
  effect,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { SidebarComponent } from './components/sidebar/sidebar';
import { DashboardComponent } from './components/dashboard/dashboard';
import { TemplateViewerComponent } from './components/template-viewer/template-viewer';

import {
  Tpl,
  NEW_TEMPLATE_FIELD_KEYS,
} from './data/sample-templates';
import {
  fetchTemplatesCatalog,
  saveTemplatesCatalog,
  getHiddenBuiltInIds,
  hideBuiltInTemplate,
  fetchCommonMergeFields,
  uploadTemplate,
  absoluteDocxUrl,
  makeId,
} from './utils/studio-storage';

function absoluteUrl(docxUrl?: string): string {
  return absoluteDocxUrl(docxUrl);
}

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    SidebarComponent,
    DashboardComponent,
    TemplateViewerComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  // Catalog state (was React useState)
  templates = signal<Tpl[]>([]);
  commonFields = signal<Record<string, unknown>>({});
  catalogLoaded = signal(false);
  selectedId = signal<string | null>(null);
  isUploading = signal(false);
  pendingUpload = signal<{ file: File; templateId: string } | null>(null);

  // Built-in ids populated after first load
  private BUILTIN_IDS = new Set<string>();
  private firstRender = true;
  private cancelled = false;

  // Upload dialog state
  uploadOpen = signal(false);
  uploadFile = signal<File | null>(null);
  uploadName = signal('');
  uploadCategory = signal('General');
  uploadPurpose = signal('');
  uploadError = signal('');

  // Publish dialog state
  publishOpen = signal(false);
  publishTarget = signal<Tpl | null>(null);
  publishName = signal('');
  publishCategory = signal('General');
  publishPurpose = signal('');
  publishError = signal('');
  publishSubmitting = signal(false);

  // Save/publish confirmation dialog
  confirmationOpen = signal(false);
  confirmationMode = signal<'publish' | 'save'>('publish');
  confirmationName = signal('');
  lastPublishedId = signal<string | null>(null);

  // Delete confirmation dialog
  deleteOpen = signal(false);
  deleteTarget = signal<Tpl | null>(null);

  selected = computed<Tpl | null>(
    () => this.templates().find((t) => t.id === this.selectedId()) ?? null,
  );

  // Existing categories used by the ComboBox datalist
  existingCategories = computed<string[]>(() => {
    const set = new Set(['General', 'Invoice', 'ThankYou', 'TaxReceipt']);
    for (const t of this.templates()) set.add(t.type);
    return Array.from(set).sort();
  });

  // Hidden file input ref
  @ViewChild('uploadFileInput')
  uploadFileInput?: ElementRef<HTMLInputElement>;

  // Direct viewer host (used by Publish dialog Save callback)
  @ViewChild('viewer')
  viewerRef?: TemplateViewerComponent;

  constructor(private cdr: ChangeDetectorRef) {
    // Auto-persist on every template change (mirrors React's useEffect).
    effect(() => {
      const tpls = this.templates();
      if (this.firstRender) {
        this.firstRender = false;
        return;
      }
      if (!this.catalogLoaded()) return;
      saveTemplatesCatalog(tpls).catch((err: unknown) => {
        console.warn('[catalog] saveTemplatesCatalog failed:', err);
      });
    });
  }

  ngOnInit(): void {
    this.fetchInitialCatalog();
  }

  private fetchInitialCatalog(): void {
    Promise.all([fetchTemplatesCatalog(), fetchCommonMergeFields()])
      .then(([catalog, fields]) => {
        if (this.cancelled) return;
        const hidden = new Set(getHiddenBuiltInIds());
        this.BUILTIN_IDS = new Set((catalog as Tpl[]).map((t) => t.id));
        const normalized = (catalog as Tpl[])
          .filter((t) => !hidden.has(t.id))
          .map((t) => {
            if (
              t.docxUrl &&
              !/^[a-z][a-z0-9+.-]*:\/\//i.test(t.docxUrl)
            ) {
              return { ...t, docxUrl: absoluteUrl(t.docxUrl) };
            }
            return t;
          });
        this.templates.set(normalized);
        this.commonFields.set((fields as Record<string, unknown>) || {});
        this.catalogLoaded.set(true);
        this.cdr.markForCheck();
      })
      .catch((err) => {
        console.warn('[catalog] initial load failed:', err);
        this.catalogLoaded.set(true);
      });
  }

  ngOnDestroy(): void {
    this.cancelled = true;
  }

  // ------------------- selection -------------------
  onSelectTemplate(id: string) {
    this.selectedId.set(id);
  }

  onBack() {
    this.selectedId.set(null);
  }

  // ------------------- add template -------------------
  onAddTemplate() {
    const id = makeId();
    const tpl: Tpl = {
      id,
      name: 'New Letter Template',
      type: 'General',
      description: 'Blank letter template — edit to customize.',
      fieldKeys: [...NEW_TEMPLATE_FIELD_KEYS],
    };
    this.templates.update((prev) => [...prev, tpl]);
    this.selectedId.set(id);
  }

  // ------------------- upload template -------------------
  onUploadClick() {
    this.uploadFile.set(null);
    this.uploadName.set('');
    this.uploadCategory.set('General');
    this.uploadPurpose.set('');
    this.uploadError.set('');
    this.uploadOpen.set(true);
  }

  closeUpload() {
    this.uploadOpen.set(false);
    if (!this.isUploading()) this.pendingUpload.set(null);
  }

  triggerUploadFilePicker() {
    this.uploadFileInput?.nativeElement.click();
  }

  onUploadFileChange(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) {
      alert('Please select a .docx file.');
      return;
    }
    this.uploadFile.set(file);
    this.uploadName.set(file.name.replace(/\.docx$/i, ''));
  }

  async confirmUpload() {
    const file = this.uploadFile();
    if (!file) {
      alert('Please choose a .docx file to upload.');
      return;
    }

    const name =
      this.uploadName().trim() || file.name.replace(/\.docx$/i, '');
    const category = this.uploadCategory().trim() || 'General';
    const purposeTrimmed = this.uploadPurpose().trim();
    const description = purposeTrimmed || 'Uploaded .docx template';

    this.uploadOpen.set(false);
    this.isUploading.set(true);

    try {
      const result = await uploadTemplate({
        file,
        name,
        type: category,
        description,
      });
      const serverEntry = (result as { entry?: Tpl }).entry;
      if (!serverEntry || !serverEntry.id) {
        throw new Error('Server returned an invalid upload response.');
      }
      const entry: Tpl = {
        ...serverEntry,
        docxUrl: absoluteUrl(
          serverEntry.docxUrl ||
            `/Templates/${(result as { docxFileName?: string }).docxFileName}`,
        ),
      };
      this.templates.update((prev) => {
        const ids = new Set(prev.map((t) => t.id));
        if (ids.has(entry.id)) {
          return prev.map((t) => (t.id === entry.id ? entry : t));
        }
        return [...prev, entry];
      });
      this.pendingUpload.set({ file, templateId: entry.id });
      this.selectedId.set(entry.id);
    } catch (err) {
      console.error('[upload] failed:', err);
      alert(`Upload failed: ${(err as Error).message || err}`);
      this.isUploading.set(false);
      this.pendingUpload.set(null);
    }
  }

  // Called by TemplateViewer when upload completes & thumbnail captured
  onInitialUploadSaved(info: {
    templateId: string;
    thumbnailDataUri: string;
    pageCount: number;
  }) {
    if (!info.templateId) {
      this.isUploading.set(false);
      this.pendingUpload.set(null);
      return;
    }
    this.templates.update((prev) =>
      prev.map((t) => {
        if (t.id !== info.templateId) return t;
        const next: Tpl = { ...t };
        if (
          info.pageCount > 0 &&
          (!next.description || next.description.startsWith('Uploaded .docx'))
        ) {
          next.description = `Uploaded .docx (${info.pageCount} page${
            info.pageCount > 1 ? 's' : ''
          })`;
        }
        if (info.thumbnailDataUri) next.thumbnailUrl = info.thumbnailDataUri;
        return next;
      }),
    );
    this.pendingUpload.set(null);
    this.isUploading.set(false);
  }

  onInitialUploadFailed(error: Error) {
    this.selectedId.set(null);
    this.pendingUpload.set(null);
    this.isUploading.set(false);
    const message = error?.message || String(error) || 'Unknown error';
    console.error('[upload] editor open failed:', error);
    alert(`Editor could not open the uploaded template: ${message}`);
  }

  // ------------------- common fields -------------------
  onCommonFieldAdded(key: string, field: unknown) {
    this.commonFields.update((prev) => ({ ...prev, [key]: field }));
  }

  onTemplateFieldKeyAdded(info: {
    templateId: string;
    newFieldKeys: string[];
  }) {
    this.templates.update((prev) =>
      prev.map((t) =>
        t.id === info.templateId ? { ...t, fieldKeys: info.newFieldKeys } : t,
      ),
    );
  }

  // ------------------- delete template -------------------
  onDeleteTemplate(id: string) {
    const tpl = this.templates().find((t) => t.id === id) ?? null;
    this.deleteTarget.set(tpl);
    this.deleteOpen.set(true);
  }

  closeDelete() {
    this.deleteOpen.set(false);
    this.deleteTarget.set(null);
  }

  confirmDelete() {
    const target = this.deleteTarget();
    if (!target) return;
    const id = target.id;
    const wasSelected = id === this.selectedId();
    if (this.BUILTIN_IDS.has(id)) hideBuiltInTemplate(id);
    this.templates.update((prev) => prev.filter((t) => t.id !== id));
    if (wasSelected) this.selectedId.set(null);
    this.deleteOpen.set(false);
    this.deleteTarget.set(null);
  }

  // ------------------- thumbnail updates -------------------
  onThumbnailUpdated(info: { id: string; dataUri: string }) {
    this.templates.update((prev) =>
      prev.map((t) =>
        t.id === info.id ? { ...t, thumbnailUrl: info.dataUri } : t,
      ),
    );
  }

  // ------------------- save flow -------------------
  // TemplateViewer requests publish for the first time a template is saved.
  // It calls `viewer.onSavePublish` (added below) to actually save + reload.
  async onRequestPublish(tpl: Tpl) {
    this.publishTarget.set(tpl);
    this.publishName.set(tpl.name || '');
    this.publishCategory.set(tpl.type || 'General');
    this.publishPurpose.set(tpl.description || '');
    this.publishError.set('');
    this.publishOpen.set(true);
  }

  closePublish() {
    this.publishOpen.set(false);
    this.publishTarget.set(null);
    this.publishError.set('');
  }

  async confirmPublish() {
    const target = this.publishTarget();
    if (!target) return;
    const name = this.publishName().trim();
    if (!name) {
      this.publishError.set('Template name is required.');
      return;
    }
    this.publishError.set('');
    this.publishSubmitting.set(true);

    try {
      const viewer = this.viewerRef;
      if (!viewer) {
        throw new Error('Editor is not ready — please try again.');
      }
      const handle = (
        viewer as unknown as {
          onSavePublish?: (info: {
            name: string;
            category: string;
          }) => Promise<{ docxBaseName: string; thumbnailDataUri: string }>;
        }
      ).onSavePublish;
      if (typeof handle !== 'function') {
        throw new Error('Editor is not ready — please try again.');
      }
      const { docxBaseName, thumbnailDataUri } = await handle({
        name,
        category: this.publishCategory().trim() || 'General',
      });
      const slug = docxBaseName;
      this.templates.update((prev) =>
        prev.map((t) => {
          if (t.id !== target.id) return t;
          const next: Tpl = {
            ...t,
            name,
            type: this.publishCategory().trim() || 'General',
            description: this.publishPurpose().trim() || t.description,
            docxUrl: absoluteUrl(`/Templates/${slug}.docx`),
            updatedAt: new Date().toISOString(),
          };
          delete next.seedLines;
          if (thumbnailDataUri) next.thumbnailUrl = thumbnailDataUri;
          return next;
        }),
      );
      this.publishOpen.set(false);
      this.publishTarget.set(null);
      // Show the same "Template published" confirmation we use for Save
      this.confirmationName.set(name);
      this.lastPublishedId.set(target.id);
      this.confirmationMode.set('publish');
      this.confirmationOpen.set(true);
    } catch (err) {
      console.error('Publish failed:', err);
      this.publishError.set(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      this.publishSubmitting.set(false);
    }
  }

  onSaved(payload: { templateId: string; name: string }) {
    this.confirmationName.set(payload.name || '');
    this.lastPublishedId.set(payload.templateId);
    this.confirmationMode.set('save');
    this.confirmationOpen.set(true);
  }

  closeConfirmation() {
    this.confirmationOpen.set(false);
  }

  confirmationGoBack() {
    this.confirmationOpen.set(false);
    if (this.lastPublishedId()) this.selectedId.set(null);
  }
}